"""
Backend Automated Test: QR Verification & AI Risk Detection
Tests cryptographic validation, duplicate scan detection, and AI risk scoring.
"""

import pytest
import time
from app.services.qr_service import qr_service
from app.ai.risk_engine import ai_risk_engine


def test_qr_generation_and_cryptographic_verification():
    sn = "SN-TEST-VAC-001"
    bid = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    exp = int(time.time()) + 3600

    sh, nonce, sig, json_pl, data_uri = qr_service.generate_pack_qr_data(sn, bid, exp)

    assert sh.startswith("0x")
    assert nonce.startswith("0x")
    assert len(sig) == 64
    assert data_uri.startswith("data:image/png;base64,")

    # Validate parsing authentic payload
    parsed = qr_service.parse_and_validate_payload(json_pl)
    assert parsed is not None
    assert parsed["sn"] == sn
    assert parsed["sh"] == sh

    # Validate tampered payload rejection
    tampered_pl = json_pl.replace(sn, "SN-TAMPERED-FAKE")
    assert qr_service.parse_and_validate_payload(tampered_pl) is None


def test_ai_risk_engine_scoring_rules():
    # 1. Clean pack
    clean_res = ai_risk_engine.evaluate_risk(
        is_registered=True,
        scan_count=1,
        is_dispensed=False,
        is_expired=False,
        is_quarantined=False,
        is_recalled=False,
        cold_chain_breached=False
    )
    assert clean_res["risk_score"] == 0.0
    assert clean_res["risk_level"] == "LOW"

    # 2. Duplicate scans + cold chain breach
    breach_res = ai_risk_engine.evaluate_risk(
        is_registered=True,
        scan_count=3,
        is_dispensed=False,
        is_expired=False,
        is_quarantined=False,
        is_recalled=False,
        cold_chain_breached=True
    )
    assert breach_res["risk_score"] > 50.0
    assert breach_res["risk_level"] in ["HIGH", "CRITICAL"]

    # 3. Unregistered serial -> 100% Critical risk
    unreg_res = ai_risk_engine.evaluate_risk(
        is_registered=False,
        scan_count=1,
        is_dispensed=False,
        is_expired=False,
        is_quarantined=False,
        is_recalled=False,
        cold_chain_breached=False
    )
    assert unreg_res["risk_score"] == 100.0
    assert unreg_res["risk_level"] == "CRITICAL"
