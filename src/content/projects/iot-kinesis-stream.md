---
title: "Real-Time IoT Telemetry Pipeline"
description: "Real-time IoT telemetry pipeline for telecoms infrastructure monitoring: multi-device simulator publishes sensor readings to Kinesis, a Lambda consumer writes to DynamoDB with partial batch failure handling, and an async alert handler fires SNS notifications and CloudWatch metrics on threshold breaches."
techStack: ["Kinesis", "Lambda", "DynamoDB", "SNS", "CloudWatch", "Python", "Terraform"]
role: "Cloud Engineer"
year: "2026"
repoUrl: "https://github.com/tsekatm/iot-kinesis-stream"
featured: true
order: 3
---

Real-time telemetry pipeline built for telecoms infrastructure monitoring — cell tower cabinet temperatures, outdoor enclosure humidity, edge node power supply metrics.

## What it does

- Device simulator publishes readings for N devices at configurable intervals, with 5% anomaly injection
- Kinesis consumer Lambda decodes, validates, writes to DynamoDB, and triggers alerts — all in one batch pass
- Alert handler classifies breaches (temperature > 45°C, humidity > 85% or < 20%), publishes SNS and CloudWatch metrics
- CloudWatch alarm on `AnomalyCount > 5/hour` pages on-call automatically
- 30 unit tests across 3 modules (TDD)

## Technical highlights

- `device_id` as Kinesis partition key ensures per-device ordering for rate-of-change detection
- `Decimal(str(value))` converts floats for DynamoDB compatibility
- `InvocationType="Event"` fire-and-forget alert invocation prevents SNS latency backing up the stream
- `bisect_batch_on_function_error + ReportBatchItemFailures` for fine-grained record-level retry
