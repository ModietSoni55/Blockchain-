"""
Backend Automated Test: Cold-Chain Telemetry Evaluation
"""

import pytest
from datetime import datetime, timedelta
from app.models.batch import Batch
from app.services.telemetry_service import telemetry_service


def test_cold_chain_threshold_detection():
    batch = Batch(
        batch_id="0xsamplebatchid",
        batch_code="BATCH-TEST",
        product_code="GTIN-123",
        brand_name="TestVaccine",
        generic_name="TestGeneric",
        dosage_form="Vial",
        strength="1ml",
        total_packs=10,
        min_temp=2.0,
        max_temp=8.0,
        expires_at=datetime.utcnow() + timedelta(days=100),
        manufacturer_address="0x123"
    )

    # 1. Normal safe reading: 4.5°C
    breached, b_type = telemetry_service.evaluate_reading(batch, 4.5)
    assert not breached
    assert b_type is None

    # 2. Overheating breach: 12.0°C
    breached, b_type = telemetry_service.evaluate_reading(batch, 12.0)
    assert breached
    assert b_type == "OVERHEATING"

    # 3. Subcooling breach: -1.0°C
    breached, b_type = telemetry_service.evaluate_reading(batch, -1.0)
    assert breached
    assert b_type == "SUBCOOLING"
