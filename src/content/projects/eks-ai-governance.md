---
title: "AI Governance Platform — EKS"
description: "FastAPI inference service deployed on Amazon EKS demonstrating production AI governance: per-request audit logging, machine-readable model card with EU AI Act classification and fairness metrics, Helm chart with horizontal pod autoscaling, and Terraform-provisioned EKS cluster with IRSA."
techStack: ["FastAPI", "EKS", "Helm", "Terraform", "Python", "scikit-learn", "Docker"]
role: "Platform Engineer"
year: "2026"
repoUrl: "https://github.com/tsekatm/eks-ai-governance"
featured: true
order: 4
---

AI governance platform showing how to operationalise responsible AI requirements on Kubernetes — audit trails, model cards, fairness metadata, and regulatory classification baked into the service layer.

## What it does

- `/predict` — churn inference with per-request audit log entry and unique `request_id` for compliance traceability
- `/governance/model-card` — machine-readable model card with version, metrics, fairness scores, EU AI Act tier, and review date
- `/governance/audit-log` — full prediction audit trail queryable by downstream compliance tooling
- HPA scales 2–10 pods on CPU (70%) and memory (80%) thresholds, both overridable per environment
- 23 unit tests (TDD) covering inference, audit log, model card, and health probes

## Technical highlights

- POPIA/RICA-aware audit design: features and predictions logged, raw PII excluded
- Fairness metrics (demographic parity, equalized odds) computed in the SageMaker eval pipeline and published to the model card per training run
- `enable_irsa = true` in Terraform — pods assume IAM roles via OIDC, no static credentials
- Multi-stage Docker build: 146 MB image, non-root user, baked-in health check
- Helm `_helpers.tpl` with `fullname`, `labels`, `selectorLabels` — lint-clean chart
