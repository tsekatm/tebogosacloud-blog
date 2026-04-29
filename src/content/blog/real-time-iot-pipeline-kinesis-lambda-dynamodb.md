---
title: "Building a Real-Time IoT Telemetry Pipeline with Kinesis, Lambda, and DynamoDB"
description: "How I built a real-time IoT data pipeline on AWS — device simulator → Kinesis stream → Lambda consumer → DynamoDB — with anomaly detection that fires SNS alerts and CloudWatch metrics."
pubDate: 2026-04-29
category: "Cloud Engineering"
tags: ["aws", "iot", "kinesis", "lambda", "python"]
draft: false
---

Every telecoms network has thousands of physical devices — routers, base stations, environmental sensors in data centres — quietly reporting readings every few seconds. When a sensor in a remote data centre starts reporting 52°C, you want to know immediately, not when someone notices the hardware has throttled.

This post walks through an IoT telemetry pipeline I built on AWS: a device simulator that generates realistic sensor data, a Kinesis stream to buffer it, a Lambda consumer that writes every reading to DynamoDB, and an alert handler that fires SNS notifications and CloudWatch metrics the moment a reading breaches a threshold.

> **Source code**: [github.com/tsekatm/iot-kinesis-stream](https://github.com/tsekatm/iot-kinesis-stream)

---

## Architecture

```
Device Simulator (Python)
  └── put_record → Kinesis Data Stream
                         │
                         ▼
              Lambda: Kinesis Consumer
                │  (decode → validate → write)
                │
                ├──► DynamoDB (iot-sensor-readings)
                │    PK=device_id, SK=timestamp
                │
                └──► Lambda: Alert Handler (async invoke)
                              │
                              ├──► SNS Topic → Email / SMS
                              └──► CloudWatch
                                   IoTPipeline/Alerts :: AnomalyCount
```

Three components. Each one does exactly one thing.

In a telecoms context, these sensors monitor cabinet temperatures at cell tower sites, humidity in outdoor street-cabinet enclosures, and power supply metrics at edge nodes. The same pipeline pattern applies equally to network KPIs — signal strength, packet loss, handover failure rates — anywhere you need a low-latency path from raw telemetry to an ops team notification.

---

## Step 1: Device Simulator

The simulator generates realistic sensor readings and publishes them to Kinesis. Normal readings stay within plausible operating ranges; a configurable anomaly probability injects spikes for demo and testing purposes.

```python
# src/device_simulator.py

TEMP_NORMAL   = (15.0, 35.0)
TEMP_SPIKE    = (46.0, 60.0)    # above the 45°C alert threshold
HUMIDITY_NORMAL = (30.0, 80.0)
ANOMALY_PROBABILITY = 0.05      # 5% of readings are anomalies

def generate_telemetry(device_id: str, anomaly: bool = False) -> dict:
    if anomaly or random.random() < ANOMALY_PROBABILITY:
        temperature = round(random.uniform(*TEMP_SPIKE), 2)
        humidity_range = random.choice([HUMIDITY_HIGH_SPIKE, HUMIDITY_LOW_SPIKE])
        humidity = round(random.uniform(*humidity_range), 2)
    else:
        temperature = round(random.uniform(*TEMP_NORMAL), 2)
        humidity = round(random.uniform(*HUMIDITY_NORMAL), 2)

    return {
        "device_id": device_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "temperature": temperature,
        "humidity": humidity,
        "pressure": round(random.uniform(950.0, 1050.0), 2),
        "firmware_version": "1.2.0",
    }

def publish_telemetry(client, device_id: str, payload: dict) -> None:
    client.put_record(
        StreamName=KINESIS_STREAM_NAME,
        Data=json.dumps(payload).encode("utf-8"),
        PartitionKey=device_id,    # routes same device to same shard
    )
```

Using `device_id` as the Kinesis partition key means all readings from the same device land in the same shard and are consumed in order. This matters if you later want to add rate-of-change anomaly detection — you need time-ordered records per device.

```python
def run_simulator(num_devices: int, interval_seconds: float,
                  max_iterations: Optional[int] = None) -> None:
    client = boto3.client("kinesis", region_name=AWS_REGION)
    device_ids = [f"device-{i:04d}" for i in range(num_devices)]

    while max_iterations is None or iteration < max_iterations:
        for device_id in device_ids:
            payload = generate_telemetry(device_id)
            publish_telemetry(client, device_id, payload)
        time.sleep(interval_seconds)
```

Run it:

```bash
python -m src.device_simulator --devices 10 --interval 5
```

---

## Step 2: Kinesis Consumer Lambda

The consumer Lambda is triggered by a Kinesis event source mapping. It processes records in batches of up to 100, decoding each record from base64 JSON, validating it, writing to DynamoDB, and checking for anomalies.

### Decoding records

Kinesis records arrive as base64-encoded bytes. Decoding is a one-liner:

```python
def decode_record(record: dict) -> Optional[dict]:
    try:
        raw_data = base64.b64decode(record["kinesis"]["data"])
        return json.loads(raw_data)
    except (KeyError, json.JSONDecodeError) as e:
        logger.warning("Skipping malformed record: %s", e)
        return None
```

### The Decimal gotcha

DynamoDB does not accept Python `float`. If you try to write `{"temperature": 23.5}`, you'll get a `TypeError: Float types are not supported`. The fix is `Decimal`, and the safest way to convert is `Decimal(str(value))` — not `Decimal(value)` which inherits floating-point imprecision:

```python
from decimal import Decimal

item = {
    "device_id":   payload["device_id"],
    "timestamp":   payload["timestamp"],
    "temperature": Decimal(str(payload["temperature"])),   # ✓
    "humidity":    Decimal(str(payload["humidity"])),
    "pressure":    Decimal(str(payload["pressure"])),
    "ingestion_timestamp": datetime.now(timezone.utc).isoformat(),
}
table.put_item(Item=item)
```

### Partial batch responses

If one record fails (malformed payload, DynamoDB write error), only that record should be retried — not the whole batch of 100. Kinesis supports this via partial batch responses:

```python
def handler(event, context):
    batch_item_failures = []
    for record in event.get("Records", []):
        try:
            payload = decode_record(record)
            validate_payload(payload)
            write_to_dynamodb(payload)
            check_and_invoke_alerts(payload)
        except Exception as e:
            seq = record["kinesis"]["sequenceNumber"]
            batch_item_failures.append({"itemIdentifier": seq})

    return {"batchItemFailures": batch_item_failures}
```

### Async alert invocation

When a reading breaches a threshold, the consumer invokes the alert handler Lambda asynchronously (`InvocationType="Event"`). This is fire-and-forget — the consumer doesn't wait for the alert to complete, so one slow SNS publish can't back up the stream:

```python
def check_and_invoke_alerts(payload: dict) -> None:
    temp, humidity = payload.get("temperature", 0), payload.get("humidity", 50)

    if temp > TEMP_THRESHOLD or humidity > HUMIDITY_HIGH or humidity < HUMIDITY_LOW:
        lambda_client.invoke(
            FunctionName=ALERT_FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps(payload).encode("utf-8"),
        )
```

---

## Step 3: Alert Handler Lambda

The alert handler has three responsibilities: classify which thresholds were breached, publish an SNS notification, and emit a CloudWatch metric.

```python
def detect_anomalies(payload: dict) -> list:
    anomalies = []

    temp = payload.get("temperature")
    if temp is not None and temp > TEMP_THRESHOLD:
        anomalies.append({
            "field": "temperature",
            "value": float(temp),
            "threshold": TEMP_THRESHOLD,
            "direction": "above",
        })

    humidity = payload.get("humidity")
    if humidity is not None:
        if humidity > HUMIDITY_HIGH_THRESHOLD:
            anomalies.append({"field": "humidity", "value": float(humidity),
                               "threshold": HUMIDITY_HIGH_THRESHOLD, "direction": "above"})
        elif humidity < HUMIDITY_LOW_THRESHOLD:
            anomalies.append({"field": "humidity", "value": float(humidity),
                               "threshold": HUMIDITY_LOW_THRESHOLD, "direction": "below"})

    return anomalies
```

The CloudWatch metric uses a custom namespace so it doesn't get buried in Lambda system metrics:

```python
def publish_cloudwatch_metric(payload: dict, anomalies: list) -> None:
    cloudwatch_client.put_metric_data(
        Namespace="IoTPipeline/Alerts",
        MetricData=[{
            "MetricName": "AnomalyCount",
            "Dimensions": [{"Name": "DeviceId", "Value": payload["device_id"]}],
            "Value": float(len(anomalies)),
            "Unit": "Count",
            "Timestamp": datetime.now(timezone.utc),
        }],
    )
```

This lets you set a CloudWatch alarm on `AnomalyCount > 5 per device per hour` and page on-call automatically.

---

## Test Suite: 30/30

All tests were written before implementation (TDD: red → green).

```
tests/test_device_simulator.py     9 passed
  - required fields present in every reading
  - device_id preserved correctly
  - temperature/humidity/pressure in realistic ranges
  - timestamp parses as ISO 8601
  - anomaly injection raises temperature above normal threshold
  - publish_telemetry calls put_record with correct PartitionKey
  - payload is JSON-serialisable
  - run_simulator stops after max_iterations
  - correct device IDs used across all records

tests/test_alert_handler.py        9 passed
  - no anomaly for normal readings
  - high temperature detected with direction=above
  - high humidity detected
  - low humidity detected with direction=below
  - multiple anomalies returned in one reading
  - CloudWatch put_metric_data called with IoTPipeline/Alerts namespace
  - metric value equals anomaly count
  - normal payload: no SNS publish
  - anomalous payload: SNS publish called once

tests/test_lambda_consumer.py     12 passed
  - valid record decoded correctly
  - malformed JSON returns None
  - missing kinesis key returns None
  - valid payload passes validation
  - missing field raises ValueError
  - successful DynamoDB write
  - ClientError from DynamoDB propagates
  - successful handler processes all records
  - empty event returns no failures
```

---

## Infrastructure (Terraform)

```hcl
resource "aws_kinesis_stream" "iot_stream" {
  name             = "iot-telemetry-stream"
  shard_count      = 1
  retention_period = 24
}

resource "aws_lambda_event_source_mapping" "kinesis_trigger" {
  event_source_arn              = aws_kinesis_stream.iot_stream.arn
  function_name                 = aws_lambda_function.consumer.arn
  starting_position             = "LATEST"
  batch_size                    = 100
  bisect_batch_on_function_error = true    # enables partial batch retry
  function_response_types        = ["ReportBatchItemFailures"]
}

resource "aws_dynamodb_table" "sensor_readings" {
  name         = "iot-sensor-readings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "device_id"
  range_key    = "timestamp"

  attribute {
    name = "device_id"
    type = "S"
  }
  attribute {
    name = "timestamp"
    type = "S"
  }
}

resource "aws_cloudwatch_metric_alarm" "high_anomaly_rate" {
  alarm_name          = "iot-high-anomaly-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "AnomalyCount"
  namespace           = "IoTPipeline/Alerts"
  period              = 3600    # 1 hour
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "More than 5 anomalies per device per hour"
  alarm_actions       = [aws_sns_topic.iot_alerts.arn]
}
```

`bisect_batch_on_function_error = true` paired with `ReportBatchItemFailures` response type gives you fine-grained retry — Kinesis will bisect failing batches until it isolates the exact bad record. The CloudWatch alarm closes the loop: anomalies flow from Lambda → CloudWatch metric → alarm → SNS page, all in Terraform.

---

## What I'd Add Next

- **Rate-of-change detection** — alert when temperature increases >5°C in 60 seconds, not just on absolute threshold
- **Dead letter queue** — SQS DLQ for alert handler failures so no alert is silently dropped
- **Kinesis Data Analytics** — SQL-based tumbling window aggregations for fleet-wide statistics
- **Device shadow** — track last-known state per device for context-aware alerting (only alert if device was previously healthy)
- **NMS integration** — feed anomaly events into a network management system for correlated alerting across cell sites, linking environmental faults to degraded radio KPIs
- **Edge inference with IoT Greengrass** — run threshold detection on the tower itself for latency-sensitive alerting without a round-trip to the cloud, critical for 5G edge deployments

---

**Tebogo Tseka** — Cloud Solutions Architect & ML Engineer
GitHub: [@tsekatm](https://github.com/tsekatm) | Blog: [tebogosacloud.blog](https://tebogosacloud.blog)
