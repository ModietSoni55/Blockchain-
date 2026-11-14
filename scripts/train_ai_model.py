#!/usr/bin/env python3
"""
MedSupply Sentinel - Local Scikit-Learn AI Model Trainer & Evaluator
Trains a Random Forest Risk Classifier and an Isolation Forest Anomaly Detector
on synthetic pharmaceutical supply-chain telemetry (100% Free & Local CPU).
Outputs Accuracy, Precision, Recall, F1-Score, ROC-AUC, and Confusion Matrix.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import cross_val_score, train_test_split


def generate_synthetic_dataset(n_samples: int = 1200, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    # 75% normal authentic packs, 25% compromised/counterfeit packs
    n_normal = int(n_samples * 0.75)
    n_risk = n_samples - n_normal

    normal_df = pd.DataFrame({
        "scan_count": rng.choice([1, 2], size=n_normal, p=[0.92, 0.08]),
        "already_dispensed": np.zeros(n_normal, dtype=int),
        "cold_chain_breach": rng.choice([0, 1], size=n_normal, p=[0.97, 0.03]),
        "max_temp_delta": rng.uniform(0.0, 1.5, size=n_normal),
        "location_jump_kmh": rng.uniform(20.0, 95.0, size=n_normal),
        "is_expired": np.zeros(n_normal, dtype=int),
        "is_counterfeit_or_compromised": np.zeros(n_normal, dtype=int),
    })

    risk_df = pd.DataFrame({
        "scan_count": rng.integers(2, 12, size=n_risk),
        "already_dispensed": rng.choice([0, 1], size=n_risk, p=[0.4, 0.6]),
        "cold_chain_breach": rng.choice([0, 1], size=n_risk, p=[0.35, 0.65]),
        "max_temp_delta": rng.uniform(2.5, 14.0, size=n_risk),
        "location_jump_kmh": rng.uniform(120.0, 1400.0, size=n_risk),
        "is_expired": rng.choice([0, 1], size=n_risk, p=[0.7, 0.3]),
        "is_counterfeit_or_compromised": np.ones(n_risk, dtype=int),
    })

    df = pd.concat([normal_df, risk_df], ignore_index=True)
    return df.sample(frac=1.0, random_state=seed).reset_index(drop=True)


def train_and_evaluate() -> None:
    print("==================================================================")
    print("MedSupply Sentinel - Scikit-Learn AI Risk Engine Training Pipeline")
    print("==================================================================")

    df = generate_synthetic_dataset()
    feature_cols = [
        "scan_count",
        "already_dispensed",
        "cold_chain_breach",
        "max_temp_delta",
        "location_jump_kmh",
        "is_expired",
    ]
    X = df[feature_cols]
    y = df["is_counterfeit_or_compromised"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )

    # 1. Train Isolation Forest for unsupervised anomaly detection
    iso_forest = IsolationForest(contamination=0.25, random_state=42)
    iso_forest.fit(X_train)

    # 2. Train Random Forest Classifier for supervised risk probability
    rf_clf = RandomForestClassifier(n_estimators=120, max_depth=8, random_state=42)
    rf_clf.fit(X_train, y_train)

    y_pred = rf_clf.predict(X_test)
    y_prob = rf_clf.predict_proba(X_test)[:, 1]

    acc = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred)
    rec = recall_score(y_test, y_pred)
    f1 = f1_score(y_test, y_pred)
    roc_auc = roc_auc_score(y_test, y_prob)
    cm = confusion_matrix(y_test, y_pred)
    cv_scores = cross_val_score(rf_clf, X, y, cv=5, scoring="f1")

    print(f"Samples Trained : {len(X_train)} | Test Samples: {len(X_test)}")
    print(f"Accuracy        : {acc:.4f}")
    print(f"Precision       : {prec:.4f}")
    print(f"Recall          : {rec:.4f}")
    print(f"F1-Score        : {f1:.4f} (5-Fold CV Mean: {cv_scores.mean():.4f})")
    print(f"ROC-AUC         : {roc_auc:.4f}")
    print("\nConfusion Matrix:")
    print(cm)
    print("\nFeature Importances:")
    for col, imp in zip(feature_cols, rf_clf.feature_importances_):
        print(f"  - {col:<20}: {imp:.4f}")


if __name__ == "__main__":
    train_and_evaluate()
