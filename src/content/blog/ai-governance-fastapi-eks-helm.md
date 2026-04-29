---
title: "AI Governance in Practice: FastAPI on EKS with Model Cards, Audit Logging, and Helm"
description: "How I built an AI governance platform on AWS EKS — FastAPI inference endpoint with per-request audit logging, model card endpoint, fairness metadata, and Helm-packaged deployment with HPA."
pubDate: 2026-04-29
category: "Cloud Engineering"
tags: ["aws", "kubernetes", "python", "mlops"]
draft: false
---

AI governance is increasingly a business requirement, not an afterthought. Whether it's the EU AI Act, NIST AI RMF, or an internal risk committee, the question is the same: can you prove your model is behaving as intended, on every request, with a documented audit trail?

This post walks through an AI governance platform I built on AWS EKS: a FastAPI service that runs churn inference, records every prediction to an audit log, exposes a machine-readable model card, and packages everything into a Helm chart with horizontal pod autoscaling.

> **Source code**: [github.com/tsekatm/eks-ai-governance](https://github.com/tsekatm/eks-ai-governance)

---

## Architecture

```
Client
  └── POST /predict → FastAPI (EKS pod)
                           │
                           ├── LogisticRegression inference
                           ├── Audit log entry (request_id, features, result)
                           └── Response: churn_probability, prediction, request_id

Kubernetes (EKS)
  ├── Helm chart  →  Deployment + Service + HPA (2–10 replicas)
  └── Terraform   →  VPC, EKS cluster, node groups, IAM OIDC

Governance Layer
  ├── GET /governance/model-card   → version, metrics, fairness, EU AI Act tier
  └── GET /governance/audit-log   → full prediction audit trail
```

The app is self-contained: no external database needed to demo it. Swap the in-memory audit log for DynamoDB and the model for a SageMaker endpoint and this is production-ready.

---

## Step 1: The FastAPI Application

Four responsibilities, four endpoint groups.

### Inference (`POST /predict`)

```python
class PredictRequest(BaseModel):
    customer_id: str
    tenure_months: float
    monthly_charges: float
    total_charges: float
    num_complaints: int

@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    features = np.array([[
        request.tenure_months,
        request.monthly_charges,
        request.total_charges,
        request.num_complaints,
    ]])
    scaled = _scaler.transform(features)
    churn_prob = float(_model.predict_proba(scaled)[0][1])
    prediction = "churn" if churn_prob >= 0.5 else "retain"
    request_id = str(uuid.uuid4())

    audit_log.append({
        "request_id": request_id,
        "customer_id": request.customer_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "features": request.model_dump(exclude={"customer_id"}),
        "prediction": prediction,
        "churn_probability": churn_prob,
        "model_version": MODEL_VERSION,
    })

    return PredictResponse(
        customer_id=request.customer_id,
        churn_probability=round(churn_prob, 4),
        prediction=prediction,
        model_version=MODEL_VERSION,
        request_id=request_id,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
```

Every prediction writes to the audit log before returning. The `request_id` ties the response to the log entry — useful for compliance queries: "show me exactly what the model returned for customer X on date Y."

### Model Card (`GET /governance/model-card`)

A machine-readable model card makes governance reviewable by automated tools, not just humans with PDFs.

```python
MODEL_CARD = {
    "model_id": "telecom-churn-v1",
    "version": "1.0.0",
    "type": "LogisticRegression",
    "training_date": "2026-04-29",
    "features": ["tenure_months", "monthly_charges", "total_charges", "num_complaints"],
    "metrics": {
        "accuracy": 0.89,
        "roc_auc": 0.92,
        "precision": 0.85,
        "recall": 0.81,
    },
    "fairness": {
        "demographic_parity_difference": 0.03,
        "equalized_odds_difference": 0.02,
        "evaluation_date": "2026-04-29",
    },
    "governance_tier": "Medium Risk",
    "eu_ai_act_classification": "Limited Risk",
    "approved_by": "AI Governance Board",
    "next_review": "2026-10-29",
}
```

The `governance_tier` and `eu_ai_act_classification` fields are what a risk committee actually needs. A CI gate could fail a deployment if these fields are missing or if `next_review` is in the past.

In a telecoms context, POPIA (South Africa) and RICA compliance add additional constraints on what customer data can flow through inference pipelines, making PII-aware audit logging essential. The audit log here records features and predictions but not raw PII — in production, `customer_id` would be a pseudonymised identifier resolved only by authorised downstream systems.

The fairness metrics (`demographic_parity_difference`, `equalized_odds_difference`) are hardcoded for this demo. In production, they are computed during the evaluation step of the SageMaker Pipeline (see Part 2 of this series) against protected attributes and updated automatically per training run before the model card is published.

### Audit Log (`GET /governance/audit-log`)

```python
@app.get("/governance/audit-log")
def get_audit_log() -> dict:
    return {"total": len(audit_log), "entries": list(audit_log)}
```

Simple. In production this would be backed by DynamoDB with a `device_id + timestamp` key schema — the same pattern used in the IoT pipeline project.

### Health probes

```python
@app.get("/healthz")
def healthz():
    return {"status": "ok", "model_version": MODEL_VERSION}

@app.get("/ready")
def ready():
    return {"status": "ready", "model_id": MODEL_ID}
```

Two separate probes because Kubernetes needs them for different purposes: `/healthz` is the liveness check (restart if down), `/ready` is the readiness check (remove from service if not ready to serve traffic). The readiness probe path is configurable in Helm values.

---

## Step 2: The Model

The model is a `LogisticRegression` trained on 2,000 synthetic telecom accounts at module load time:

```python
_rng = np.random.default_rng(42)
_X_train = np.column_stack([
    _rng.uniform(1, 72, 2000),     # tenure_months
    _rng.uniform(20, 150, 2000),   # monthly_charges
    _rng.uniform(20, 10000, 2000), # total_charges
    _rng.integers(0, 8, 2000),     # num_complaints
])
# Rule: ≥3 complaints, or new customer + high charge → churn
_y_train = (
    (_X_train[:, 3] >= 3) |
    ((_X_train[:, 0] < 6) & (_X_train[:, 1] > 80))
).astype(int)

_scaler = StandardScaler()
_model = LogisticRegression(max_iter=200, random_state=42)
_model.fit(_scaler.fit_transform(_X_train), _y_train)
```

Replacing this with a SageMaker endpoint call is a one-function swap — the governance layer (audit logging, model card) stays identical.

---

## Step 3: Test Suite — 23/23

All tests written before implementation (TDD).

```
tests/test_app.py::TestHealthEndpoints        4 passed
  - /healthz returns 200 with status "ok"
  - /ready returns 200 with status "ready"

tests/test_app.py::TestPredictEndpoint        9 passed
  - 200 on valid payload
  - customer_id, churn_probability (0–1), prediction, model_version, request_id present
  - 422 on missing field
  - high-risk profile (1 month tenure, 5 complaints) → churn
  - low-risk profile (60 months, 0 complaints) → retain

tests/test_app.py::TestAuditLog               5 passed
  - empty initially
  - records entry after prediction
  - entry contains customer_id and prediction
  - total count increments correctly

tests/test_app.py::TestModelCard              5 passed
  - 200 response
  - version, metrics, fairness, governance_tier present
```

The fixture `autouse=True` on `clear_audit_log` ensures each test class starts with a clean in-memory log — no test bleeds state into the next.

---

## Step 4: Docker — Multi-Stage Build

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim AS production
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser
WORKDIR /app
COPY --from=builder /install /usr/local
COPY . .
RUN chown -R appuser:appuser /app
USER appuser
EXPOSE 8080
HEALTHCHECK CMD curl -f http://localhost:8080/healthz || exit 1
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

Two stages: the builder installs build tools and compiles packages; production copies only the compiled artifacts. Result: **146 MB image**, non-root user, health check baked in.

```bash
docker build --platform linux/amd64 -t ai-governance-platform:local .
# Successfully built d1a906f056b5 — 146MB
```

---

## Step 5: Helm Chart with HPA

The chart packages deployment + service + HPA into a single parameterised artifact.

### HPA

```yaml
# helm/templates/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: {{ .Values.autoscaling.minReplicas }}   # 2
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}   # 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}   # 70
    - type: Resource
      resource:
        name: memory
        target:
          averageUtilization: {{ .Values.autoscaling.targetMemoryUtilizationPercentage }} # 80
```

The HPA scales between 2 and 10 pods on CPU (70%) and memory (80%) utilisation. Both thresholds are overridable per environment via `values.yaml`.

### `_helpers.tpl`

Helm charts need a `_helpers.tpl` file to define shared template functions like `fullname` and `labels`. Without it, the templates can't render:

```gotpl
{{- define "ai-platform.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
```

```bash
helm lint ./helm/
# ==> Linting ./helm/
# 1 chart(s) linted, 0 chart(s) failed
```

Deploy:

```bash
helm install ai-platform ./helm -f helm/values.yaml
kubectl get pods    # 2–10 replicas depending on load
kubectl get hpa     # watch scaling events
```

---

## Step 6: Infrastructure (Terraform)

The EKS cluster is provisioned with Terraform — nothing clicked in the console.

```hcl
module "eks" {
  source          = "terraform-aws-modules/eks/aws"
  version         = "~> 20.0"
  cluster_name    = "ai-governance-cluster"
  cluster_version = "1.30"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets

  eks_managed_node_groups = {
    general = {
      instance_types = ["m5.large"]
      min_size       = 2
      max_size       = 6
      desired_size   = 3
    }
  }

  enable_irsa = true    # IAM Roles for Service Accounts — pods get AWS creds without node-level keys
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"
  name    = "ai-governance-vpc"
  cidr    = "10.0.0.0/16"

  azs             = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway = true
}
```

`enable_irsa = true` provisions the OIDC provider so the `ai-platform-sa` service account (created by Helm) can assume an IAM role for DynamoDB and CloudWatch access — no static AWS credentials in the pod.

---

## What I'd Add Next

- **SageMaker endpoint** — replace the in-memory model with `boto3.client("sagemaker-runtime").invoke_endpoint()`, zero governance layer changes needed
- **DynamoDB audit store** — replace the in-memory list with a DynamoDB table (`model_id + timestamp` key), enables cross-pod audit queries
- **Bedrock Guardrails** — content filtering and PII redaction on inference inputs before they hit the model; a pattern I've already implemented in production for prompt injection prevention
- **CI gate on model card** — fail deployment if `next_review` is expired or `governance_tier` is missing
- **Prometheus metrics** — `prediction_count`, `churn_rate`, `p99_latency` scraped by CloudWatch Container Insights

---

**Tebogo Tseka** — Cloud Solutions Architect & ML Engineer
GitHub: [@tsekatm](https://github.com/tsekatm) | Blog: [tebogosacloud.blog](https://tebogosacloud.blog)
