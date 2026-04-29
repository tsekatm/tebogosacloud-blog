---
title: "Building a Production MLOps Pipeline on AWS SageMaker for Telecom Churn"
description: "How I built an end-to-end MLOps pipeline with SageMaker Pipelines, automated retraining via EventBridge, and drift monitoring using KS tests and CloudWatch — for a telecom churn use case."
pubDate: 2026-04-29
category: "Machine Learning & MLOps"
tags: ["mlops", "aws", "sagemaker", "python", "telecom"]
draft: false
---

In my [previous post](/blog/predicting-telecom-churn-sklearn-keras-sagemaker), we trained a churn prediction model and deployed it to a SageMaker endpoint. That's where most tutorials stop. But in production, deploying a model is only the beginning.

Models degrade. Customer behaviour shifts. Contract mix changes when competitors launch new offers. A model trained on January's data may be quietly wrong by June — and without active monitoring, nobody will know until the churn rate climbs and someone asks awkward questions in a board meeting.

This post covers the system I built to make that model **self-maintaining**: an end-to-end MLOps pipeline that retrains automatically, gates on model quality, and raises alerts the moment it detects something drifting.

---

## What We're Building

```
EventBridge (daily schedule)
        │
        ▼
Lambda: trigger_retraining
        │
        ▼
SageMaker Pipeline
  ├── Phase 1: PreprocessData   → encode, scale, split
  ├── Phase 2: TrainModel       → SKLearn estimator
  ├── Phase 3: EvaluateModel    → writes evaluation.json
  └── Phase 4: CheckAccuracy    → ROC-AUC ≥ 0.80?
           ├── YES → RegisterModel (PendingManualApproval)
           └── NO  → skip registration

Model Monitor (separate Lambda)
  ├── KS test on numeric features
  ├── Chi-squared on categorical features
  └── Alerts → SNS → CloudWatch
```

The whole pipeline is infrastructure-as-code (Terraform), parameterised, and testable locally with 24 unit tests.

---

## Phase 1: The Pipeline Definition

SageMaker Pipelines SDK lets you define a DAG of steps in Python. The pipeline object is then serialised to JSON and pushed to SageMaker, which manages execution, retry, and lineage tracking.

```python
# pipeline/pipeline.py
from sagemaker.workflow.pipeline import Pipeline
from sagemaker.workflow.parameters import ParameterFloat, ParameterString
from sagemaker.workflow.steps import ProcessingStep, TrainingStep
from sagemaker.workflow.condition_step import ConditionStep
from sagemaker.workflow.conditions import ConditionGreaterThanOrEqualTo

def create_pipeline() -> Pipeline:
    # Overridable at execution time — no hardcoded values
    accuracy_threshold = ParameterFloat(name="AccuracyThreshold", default_value=0.80)
    input_data_uri = ParameterString(name="InputDataUri", default_value=f"s3://{default_bucket}/data/raw/")

    processing_step = ProcessingStep(
        name="PreprocessData",
        processor=sklearn_processor,
        inputs=[ProcessingInput(source=input_data_uri, destination="/opt/ml/processing/input")],
        outputs=[
            ProcessingOutput(output_name="train", source="/opt/ml/processing/output/train"),
            ProcessingOutput(output_name="test",  source="/opt/ml/processing/output/test"),
        ],
        code="pipeline/preprocess.py",
    )

    # ... training_step, evaluation_step setup omitted for brevity — see pipeline.py in the repo

    condition_step = ConditionStep(
        name="CheckAccuracy",
        conditions=[ConditionGreaterThanOrEqualTo(
            left=JsonGet(step_name="EvaluateModel", property_file=evaluation_report,
                         json_path="metrics.accuracy.value"),  # accuracy chosen: simpler threshold, business-readable
            right=accuracy_threshold,
        )],
        if_steps=[register_step],
        else_steps=[],
    )

    return Pipeline(
        name="telecom-churn-pipeline",
        parameters=[input_data_uri, accuracy_threshold],
        steps=[processing_step, training_step, evaluation_step, condition_step],
    )
```

Every meaningful value — instance types, thresholds, data paths — is a `ParameterString` or `ParameterFloat`. The Lambda trigger can override any of them per execution without touching the pipeline definition.

> **Why accuracy and not ROC-AUC for gating?** ROC-AUC is the better model quality metric (as argued in [Part 1](/blog/predicting-telecom-churn-sklearn-keras-sagemaker)), but SageMaker ConditionalStep thresholds need to be intuitive for non-ML stakeholders who approve deployments. "Accuracy must exceed 80%" is easier to explain in a business review than an AUC threshold. You can always swap `metrics.accuracy.value` → `metrics.roc_auc.value` and adjust the threshold.

---

## Phase 2: Preprocessing with Synthetic Fallback

The preprocessing script has to run inside a SageMaker Processing container, so it can't assume anything about the environment. I built in a synthetic data fallback so the pipeline can run end-to-end even before real production data exists:

```python
# pipeline/preprocess.py
def load_data(input_dir: str) -> pd.DataFrame:
    csv_files = [f for f in os.listdir(input_dir) if f.endswith(".csv")] \
                if os.path.isdir(input_dir) else []
    if csv_files:
        return pd.read_csv(os.path.join(input_dir, csv_files[0]))
    print("No input CSV found — generating synthetic telecom data")
    return generate_synthetic_data(n=8000)

def split_and_save(X: np.ndarray, y: np.ndarray, test_size: float = 0.2) -> None:
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=42, stratify=y
    )
    # SageMaker convention: target first, no header
    train_df = pd.DataFrame(np.column_stack([y_train, X_train]))
    train_df.to_csv(os.path.join(TRAIN_OUTPUT_DIR, "train.csv"), index=False, header=False)
```

Two details worth noting:
- **Stratified split** — the churn class is imbalanced (~37%). Without stratification you risk the test set having a different class ratio than training.
- **Scaler fit on train only** — `StandardScaler().fit_transform(X_train)` then `.transform(X_test)`. A common mistake is fitting the scaler on all data, which leaks test set statistics into training.

---

## Phase 3: Evaluation Report

The evaluation step writes a JSON file that the ConditionalStep reads. This is how SageMaker Pipelines communicates metric values between steps:

```python
# pipeline/evaluate.py
def compute_metrics(model, model_type, X_test, y_test) -> dict:
    if model_type == "sklearn":
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)[:, 1]
    else:  # keras
        y_prob = model.predict(X_test).flatten()
        y_pred = (y_prob >= 0.5).astype(int)

    return {
        "accuracy":  {"value": round(accuracy_score(y_test, y_pred), 4)},
        "precision": {"value": round(precision_score(y_test, y_pred, zero_division=0), 4)},
        "recall":    {"value": round(recall_score(y_test, y_pred, zero_division=0), 4)},
        "f1":        {"value": round(f1_score(y_test, y_pred, zero_division=0), 4)},
        "roc_auc":   {"value": round(roc_auc_score(y_test, y_prob), 4)},
    }

def write_evaluation_report(metrics: dict, output_dir: str) -> None:
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, "evaluation.json"), "w") as f:
        json.dump({"metrics": metrics}, f, indent=2)
```

The `PropertyFile` in the pipeline definition tells SageMaker where to find this JSON and which key to extract (`metrics.accuracy.value`). The ConditionalStep compares that value against the `AccuracyThreshold` parameter.

---

## Phase 4: Automated Retraining via EventBridge

The Lambda trigger is intentionally simple — it just maps the incoming event to SageMaker pipeline parameters and starts an execution:

```python
# src/trigger_retraining.py
PARAM_MAP = {
    "input_data_uri":       "InputDataUri",
    "training_instance_type": "TrainingInstanceType",
    "accuracy_threshold":   "AccuracyThreshold",
}

def _build_parameters(event: dict) -> list:
    overrides = event.get("pipeline_parameters", {})
    return [
        {"Name": PARAM_MAP[k], "Value": str(v)}
        for k, v in overrides.items()
        if k in PARAM_MAP
    ]

def handler(event: dict, context) -> dict:
    params = _build_parameters(event)
    response = sagemaker_client.start_pipeline_execution(
        PipelineName=PIPELINE_NAME,
        PipelineParameters=params,
    )
    return {
        "statusCode": 200,
        "body": json.dumps({"execution_arn": response["PipelineExecutionArn"]}),
    }
```

EventBridge fires this on a daily schedule. It can also be invoked on demand — for example, when an upstream data pipeline completes and drops new CSV files into the S3 raw bucket. The `pipeline_parameters` field in the event payload makes it easy to run A/B experiments with different thresholds or instance types without changing any code.

---

## Phase 5: Drift Monitoring

This is the part that actually keeps the model honest. The monitoring Lambda runs separately on a schedule and checks two things:

### Data Drift — Did the input distribution change?

```python
# src/monitor.py
from scipy import stats

def check_data_drift(baseline: pd.DataFrame, current: pd.DataFrame,
                     threshold: float = 0.05) -> dict:
    results = {"features": {}, "drift_detected": False, "drifted_features": []}

    # Kolmogorov-Smirnov test for numeric features
    for col in NUMERIC_COLS:
        stat, p_value = stats.ks_2samp(
            baseline[col].dropna().values,
            current[col].dropna().values,
        )
        drifted = bool(p_value < threshold)  # cast to Python bool for JSON serialisation
        results["features"][col] = {"test": "ks_2samp", "p_value": round(float(p_value), 4),
                                    "drift_detected": drifted}
        if drifted:
            results["drift_detected"] = True
            results["drifted_features"].append(col)

    # Chi-squared test for categorical features
    for col in CATEGORICAL_COLS:
        all_cats = set(baseline[col].unique()) | set(current[col].unique())
        baseline_counts = baseline[col].value_counts().reindex(all_cats, fill_value=0)
        current_counts  = current[col].value_counts().reindex(all_cats, fill_value=0)
        stat, p_value = stats.chisquare(
            f_obs=current_counts.values + 1,   # +1 Laplace smoothing
            f_exp=baseline_counts.values + 1,
        )
        drifted = bool(p_value < threshold)
        results["features"][col] = {"test": "chi_squared", "p_value": round(float(p_value), 4),
                                    "drift_detected": drifted}
        if drifted:
            results["drift_detected"] = True
            results["drifted_features"].append(col)

    return results
```

The KS test is ideal for numeric features — it's non-parametric and sensitive to any difference in distribution shape, not just mean shifts. Chi-squared works for categoricals because we're comparing frequency counts across buckets.

One subtle bug I hit during testing: `scipy.stats.ks_2samp` returns `numpy.bool_`, not Python `bool`. The `json.dumps` call inside `run_monitoring` raises `TypeError: Object of type bool is not JSON serializable` unless you explicitly cast to `bool`. The fix is one word: `bool(p_value < threshold)`.

### Model Drift — Is the model's behaviour changing?

```python
def check_model_drift(predictions: pd.Series, actuals: pd.Series = None,
                      baseline_accuracy: float = 0.80) -> dict:
    pred_churn_rate = float(predictions.mean())
    results = {"model_drift_detected": False, "prediction_churn_rate": round(pred_churn_rate, 4)}

    # Flag if predicted churn rate deviates >15pp from the expected ~37%
    if abs(pred_churn_rate - 0.37) > 0.15:
        results["model_drift_detected"] = True

    # If ground truth labels are available (delayed feedback loop)
    if actuals is not None:
        current_accuracy = float(accuracy_score(actuals, predictions))
        degradation = baseline_accuracy - current_accuracy
        results["current_accuracy"] = round(current_accuracy, 4)
        results["degradation"] = round(degradation, 4)
        if degradation > 0.05:   # 5pp drop triggers alert
            results["model_drift_detected"] = True

    return results
```

In telecom, ground truth labels (actual churn) arrive weeks after the prediction — when the customer's contract period ends. The `actuals` parameter handles this delayed feedback loop: when labels are available, we compute live accuracy against the baseline. When they're not, we fall back to distribution monitoring on prediction outputs.

---

## Test Suite: 24/24

Every module has a corresponding test file. I wrote tests first, then implemented:

```
tests/test_preprocess.py          10 passed
  - synthetic data shape, churn rate, no nulls
  - duplicate removal, missing target rows dropped
  - engineer_features returns arrays, binary labels, scaled means
  - split_and_save creates files with correct ratio

tests/test_monitor.py              8 passed
  - similar data does NOT trigger drift
  - 3x shifted tenure_months DOES trigger KS drift
  - all 12 features present in result dict
  - normal predictions: no model drift
  - all-churn predictions: drift flagged
  - accuracy degradation (baseline 0.99 vs random): flagged

tests/test_trigger_retraining.py   6 passed
  - empty event → empty parameter list
  - input_data_uri extracted correctly
  - accuracy_threshold extracted
  - three overrides → three parameters
  - success response returns 200 + execution_arn
  - ResourceNotFound → 404/500 (graceful)
```

One test worth highlighting: `test_no_drift_similar_data` uses `threshold=0.001` (very sensitive) on resampled data — even bootstrap-resampled data from the same distribution should not flag drift at normal operating thresholds. This confirms the monitor won't generate false alarms under normal variance.

---

## Infrastructure (Terraform)

All AWS resources are provisioned via Terraform — nothing is clicked in the console:

```hcl
# terraform/main.tf (excerpt)
resource "aws_lambda_function" "trigger_retraining" {
  function_name = "telecom-churn-trigger-retraining"
  runtime       = "python3.11"
  handler       = "trigger_retraining.handler"
  role          = aws_iam_role.lambda_execution.arn
  filename      = data.archive_file.lambda_zip.output_path

  environment {
    variables = {
      PIPELINE_NAME = var.pipeline_name
      AWS_REGION    = var.aws_region
    }
  }
}

resource "aws_cloudwatch_event_rule" "daily_retraining" {
  name                = "telecom-churn-daily-retrain"
  schedule_expression = "cron(0 2 * * ? *)"  # 02:00 UTC daily
}
```

Lambda execution roles follow least-privilege: `sagemaker:StartPipelineExecution` on the specific pipeline ARN, nothing broader.

---

## What I'd Add Next

- **A/B model deployment** — route 10% of traffic to the new model, compare live accuracy before full cutover
- **Feature store** — SageMaker Feature Store for consistent feature engineering between training and inference
- **Approval webhook** — Slack notification when a model lands in `PendingManualApproval`, with approve/reject buttons
- **CDR integration** — feed Call Detail Records for real-time churn scoring at the network edge, beyond batch retraining

---

## Source Code

Full project: [github.com/tsekatm/mlops-sagemaker-pipeline](https://github.com/tsekatm/mlops-sagemaker-pipeline)

Previous post (model training + endpoint deployment): [Predicting Telecom Customer Churn with scikit-learn, Keras, and SageMaker](/blog/predicting-telecom-churn-sklearn-keras-sagemaker)

---

**Tebogo Tseka** — Cloud Solutions Architect & ML Engineer
GitHub: [@tsekatm](https://github.com/tsekatm) | Blog: [tebogosacloud.blog](https://tebogosacloud.blog)
