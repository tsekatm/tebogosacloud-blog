---
title: "Predicting Telecom Customer Churn with scikit-learn, Keras, and Amazon SageMaker"
description: "Learn how to build a telecom customer churn predictor using Random Forest, Keras neural networks, and deploy it to a real-time SageMaker endpoint. Full code included."
pubDate: 2026-04-29
category: "AWS & Cloud Architecture"
tags: ["machinelearning", "aws", "sagemaker", "python", "telecom"]
draft: false
---

Every month, a telecom operator quietly loses thousands of customers to a competitor. They call it **churn** — and in an industry where acquiring a new customer costs 5–10x more than retaining an existing one, predicting who is about to leave is one of the most valuable problems machine learning can solve.

In this tutorial, I'll walk you through a complete churn prediction pipeline I built for a telecom use case. We'll generate a realistic synthetic dataset, train three models (Decision Tree, Random Forest, and a Keras neural network), compare their performance, and deploy the best one to an Amazon SageMaker real-time endpoint.

By the end, you'll have a production-ready pipeline you can adapt for any telecoms operator.

> **Full source code**: [github.com/tsekatm/ml-churn-predictor](https://github.com/tsekatm/ml-churn-predictor)

---

## Why Telecom Churn Is a Hard ML Problem

Telecom churn has a few properties that make it interesting:

- **Class imbalance**: Typically 20–40% of customers churn. The model must not simply predict "no churn" for everyone and claim 80% accuracy.
- **Behavioural signals are subtle**: A customer moving from a two-year contract to month-to-month is a strong signal — but it manifests quietly in billing data.
- **High-value interventions**: If you identify a high-risk customer 30 days early, a targeted retention offer (discounted upgrade, free month) can prevent the loss of 24+ months of revenue.

This makes **recall** — catching as many true churners as possible — more important than raw accuracy. We'll reflect that in our model design.

---

## The Dataset

No real customer data? No problem. I generated a synthetic dataset of 10,000 telecom customers with realistic churn patterns calibrated to industry benchmarks.

```bash
python data/generate_data.py
# → data/raw/churn.csv (10,000 rows, 37% churn rate)
```

The dataset captures 13 features common to any telecoms CRM:

| Feature | Type | Churn Signal Strength |
|---------|------|----------------------|
| `tenure_months` | Numeric | ⬆⬆⬆ Strong — long-tenured customers rarely leave |
| `contract_type` | Categorical | ⬆⬆⬆ Month-to-month: ~42% churn vs 3% for two-year |
| `monthly_charges` | Numeric | ⬆⬆ Higher bills correlate with higher churn |
| `internet_service` | Categorical | ⬆⬆ Fibre optic: ~41% churn (more competition) |
| `payment_method` | Categorical | ⬆ Electronic check: highest churn payment method |
| `online_security` / `tech_support` | Categorical | ⬆ Customers without add-ons are less sticky |
| `senior_citizen` | Binary | ⬆ Slight elevated churn risk |

The generator uses a logistic model over these features to produce churn labels, so the correlations are baked in — any model worth its salt should discover them.

---

## Pipeline Architecture

Here is the end-to-end flow:

```
generate_data.py        train.py               deploy.py
(10k customers)  ──►   preprocess()    ──►    package_model()
                        train_sklearn()         upload_to_s3()
                        train_keras()           create_model()
                        evaluate()              deploy_endpoint()
                        save_model()                 │
                                                     ▼
                                           SageMaker Real-Time
                                           Endpoint (CSV → probability)
```

The pipeline is intentionally simple: no feature stores, no experiment tracking servers — just clean, readable Python you can understand, extend, and interview about with confidence.

---

## Step 1: Data Preprocessing

The `preprocess()` function handles everything from raw CSV to model-ready arrays.

```python
CATEGORICAL_COLS = [
    "contract_type", "internet_service", "phone_service",
    "multiple_lines", "online_security", "tech_support",
    "payment_method", "paperless_billing",
]
NUMERIC_COLS = ["tenure_months", "monthly_charges", "total_charges", "senior_citizen"]

def preprocess(df):
    df = df.drop(columns=["customer_id"], errors="ignore").copy()
    df = df.dropna(subset=["churn"])

    # Encode categoricals
    encoders = {}
    for col in CATEGORICAL_COLS:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col].astype(str))
        encoders[col] = le

    X = df[NUMERIC_COLS + CATEGORICAL_COLS].values
    y = df["churn"].values.astype(int)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y  # preserves churn ratio
    )

    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_test = scaler.transform(X_test)   # fit only on train — never leak test stats

    return X_train, X_test, y_train, y_test, scaler, encoders
```

Two decisions worth noting:

1. **Stratified split** — without this, a random split might put disproportionately few churners in the test set, making evaluation unreliable.
2. **Fit scaler on train only** — a common mistake is to fit the scaler on the full dataset before splitting. That leaks test distribution into training.

---

## Step 2: Training Three Models

### Decision Tree — The Baseline

```python
model = DecisionTreeClassifier(
    max_depth=8,
    min_samples_leaf=10,
    class_weight="balanced",   # compensates for ~37% minority class
    random_state=42,
)
model.fit(X_train, y_train)
```

`class_weight="balanced"` tells scikit-learn to weight the loss function inversely proportional to class frequency. Without it, the tree optimises for the majority class (non-churners) and misses churners entirely.

### Random Forest — The Workhorse

```python
model = RandomForestClassifier(
    n_estimators=200,
    max_depth=12,
    min_samples_leaf=5,
    class_weight="balanced",
    random_state=42,
    n_jobs=-1,
)
```

200 trees with a maximum depth of 12 strikes a good bias-variance balance for tabular data of this size. `n_jobs=-1` uses all available CPU cores — on a modern laptop this brings training time under one second.

### Keras Neural Network — The Contender

```python
model = keras.Sequential([
    layers.Input(shape=(input_dim,)),
    layers.Dense(128, activation="relu"),
    layers.BatchNormalization(),
    layers.Dropout(0.3),
    layers.Dense(64, activation="relu"),
    layers.BatchNormalization(),
    layers.Dropout(0.2),
    layers.Dense(32, activation="relu"),
    layers.Dense(1, activation="sigmoid"),   # binary output: churn probability
])

model.compile(
    optimizer=keras.optimizers.Adam(learning_rate=1e-3),
    loss="binary_crossentropy",
    metrics=["accuracy", keras.metrics.AUC(name="auc")],
)
```

A few architectural choices:

- **Batch normalisation** stabilises training on mixed-scale tabular features (tenure is 1–72, total_charges can be 3,000+).
- **Dropout** prevents overfitting on the relatively small feature set.
- **Class weight** is applied here too — computed as `neg/pos` ratio.
- **EarlyStopping on val_auc** with `restore_best_weights=True` prevents over-training beyond peak generalisation.

---

## Step 3: Model Evaluation & Comparison

Running `python src/train.py --data data/raw/churn.csv --output models/` produces:

```
============================================================
MODEL COMPARISON SUMMARY
Model                Accuracy   Precision  Recall     ROC-AUC
------------------------------------------------------------
decision_tree        0.7430     0.6189     0.7900     0.8218
random_forest        0.7660     0.6592     0.7575     0.8453
keras_nn             0.7565     0.6298     0.8252     0.8454
============================================================
Best model by ROC-AUC: keras_nn (0.8454)
```

Some observations:

- **Random Forest and Keras NN are neck-and-neck on ROC-AUC** (0.8453 vs 0.8454) — both are excellent.
- **Keras NN wins on recall** (0.8252 vs 0.7575) — it catches more actual churners, which is what matters for retention campaigns.
- **Decision Tree** is the weakest but still achieves ROC-AUC 0.82, which is respectable and fully interpretable — useful for explaining predictions to business stakeholders.

For a real telecoms deployment, I would use the **Keras NN for scoring** (maximise recall for retention offers) and the **Decision Tree for explainability** (show why a specific customer was flagged).

For deployment, I chose **Random Forest** over Keras NN despite the marginal ROC-AUC difference (0.8453 vs 0.8454). Random Forest offers simpler packaging (joblib serialisation vs TensorFlow SavedModel), faster cold-start inference on SageMaker, and better interpretability for business stakeholders — a practical trade-off in production.

---

## Step 4: Deploying to SageMaker

The `deploy.py` module handles the full deployment lifecycle:

```python
# 1. Package the model artifact
archive = package_model("models/random_forest.pkl")   # → model.tar.gz

# 2. Upload to S3
model_s3_uri = upload_to_s3(archive, S3_BUCKET, "models/random_forest/model.tar.gz")

# 3. Register with SageMaker
create_model(model_name, role_arn, image_uri, model_s3_uri)

# 4. Create endpoint config
create_endpoint_config(config_name, model_name, instance_type="ml.m5.large")

# 5. Deploy endpoint (waits for InService)
deploy_endpoint(ENDPOINT_NAME, config_name)

# 6. Test inference
result = invoke_endpoint(ENDPOINT_NAME, "12,0,65.5,786.0,1,1,1,0,0,0,1,0")
print(f"Churn probability: {result}")
```

For a dry run (package + upload only, no endpoint creation):

```bash
python src/deploy.py --model-path models/random_forest.pkl --dry-run
```

The SageMaker sklearn inference container handles serialisation automatically — you send a CSV row, it loads `random_forest.pkl` via joblib and returns the prediction.

---

## Key Takeaways

**1. Recall beats accuracy for churn**
A model that catches 82% of churners but has lower overall accuracy is more valuable than an accurate model that misses half the churners. Always align your metric to the business objective.

**2. Class weighting is non-negotiable**
Without `class_weight="balanced"`, your model silently optimises for the majority class. This is the single most common mistake on imbalanced classification tasks.

**3. The Decision Tree earns its place**
A Random Forest with ROC-AUC 0.845 is impressive. But the Decision Tree at 0.822 can be printed, visualised, and walked through in a business presentation. In regulated industries, explainability is not optional.

**4. SageMaker packaging is straightforward**
The sklearn inference container removes almost all boilerplate from deployment. If your model is saved with joblib, `model.tar.gz` + a role ARN is all you need.

---

## What's Next

This pipeline is a solid foundation. From here, you could:

- **Add SHAP values** to explain individual predictions (why is this customer high-risk?)
- **Build a SageMaker Pipeline** for automated retraining when new monthly data arrives
- **Wire up a retention campaign API** — when the endpoint returns probability > 0.7, trigger an offer via your CRM
- **Add Model Monitor** to detect data drift when real customer behaviour shifts
- **Integrate with CDR (Call Detail Records)** for real-time churn scoring at the network edge
- **Connect predictions to CRM retention workflows** for automated intervention triggers

---

## References

1. [Amazon SageMaker Developer Guide](https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html)
2. [scikit-learn: RandomForestClassifier](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestClassifier.html)
3. [Keras: Binary Classification](https://keras.io/examples/structured_data/structured_data_classification_from_scratch/)
4. [SageMaker SKLearn Estimator](https://sagemaker.readthedocs.io/en/stable/frameworks/sklearn/sagemaker.sklearn.html)
5. [IBM Telco Customer Churn Dataset](https://www.kaggle.com/datasets/blastchar/telco-customer-churn)
6. [Handling Imbalanced Classes in scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.utils.class_weight.compute_class_weight.html)
7. [AWS re:Invent 2023 — MLOps with SageMaker Pipelines (AIM320)](https://www.youtube.com/watch?v=Hvz2GGU6RDg)

---

**Tebogo Tseka** — Cloud Solutions Architect & ML Engineer
GitHub: [@tsekatm](https://github.com/tsekatm) | Blog: [tebogosacloud.blog](https://tebogosacloud.blog)
