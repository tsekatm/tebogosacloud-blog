---
title: "Telecom Churn Predictor"
description: "Binary churn classifier built with scikit-learn (Random Forest, Logistic Regression) and Keras (deep neural network), evaluated against a real-world telecoms dataset, and deployed as a SageMaker real-time endpoint. Includes full model comparison pipeline and Jupyter exploratory analysis."
techStack: ["Python", "scikit-learn", "Keras", "SageMaker", "S3", "Jupyter"]
role: "ML Engineer"
year: "2026"
repoUrl: "https://github.com/tsekatm/ml-churn-predictor"
featured: true
order: 1
---

Binary churn classifier for telecoms customer data. Three models evaluated head-to-head — Logistic Regression, Random Forest, and a Keras deep neural network — with the best performer deployed to a SageMaker real-time endpoint.

## What it does

- Ingests a 7,000-record telecoms dataset with 20 features (contract type, tenure, charges, service add-ons)
- Trains and evaluates three classifiers, selecting the Random Forest (ROC-AUC 0.93) for deployment
- Deploys to SageMaker as a real-time inference endpoint
- 30 unit tests covering preprocessing, model evaluation, and drift detection (TDD)

## Technical highlights

- `Decimal(str(value))` pattern for DynamoDB numeric compatibility
- Feature engineering: log-transform on skewed charge columns, one-hot encoding for categoricals
- Model card with accuracy, ROC-AUC, precision, recall per class
- Drift detection module using KS test (numeric) and chi-squared (categorical)
