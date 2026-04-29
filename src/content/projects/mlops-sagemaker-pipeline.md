---
title: "MLOps Pipeline — SageMaker"
description: "End-to-end MLOps pipeline on AWS SageMaker: automated preprocessing, training, evaluation, conditional model registration, and Lambda-triggered retraining on drift detection. Built with the SageMaker Pipelines SDK and Terraform infrastructure."
techStack: ["SageMaker Pipelines", "Python", "Lambda", "S3", "Terraform", "CloudWatch"]
role: "MLOps Engineer"
year: "2026"
repoUrl: "https://github.com/tsekatm/mlops-sagemaker-pipeline"
featured: true
order: 2
---

Production-grade MLOps pipeline that automates the full model lifecycle from raw data to registered model, with automated retraining triggered by data drift.

## What it does

- 5-phase SageMaker Pipeline: Preprocess → Train → Evaluate → Conditional Register → Baseline
- Model only registered if ROC-AUC exceeds threshold — no manual promotion gate needed
- Lambda function monitors CloudWatch drift metrics and re-triggers the pipeline automatically
- 24 unit tests (TDD) covering preprocessing, drift detection, and Lambda trigger logic

## Technical highlights

- `PropertyFile` + `JsonGet` condition for automated quality gate
- `numpy.bool_` JSON serialisation fix (cast to Python `bool` before `json.dumps`)
- KS test for numeric drift, chi-squared for categorical drift
- Terraform-managed SageMaker execution roles, S3 buckets, and Lambda trigger
