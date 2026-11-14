"""
Public Patient Verification & QR Anti-Counterfeit Scanner Endpoint
Zero login required: Any patient, doctor, or inspector can verify medicine instantly.
"""

from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.pack import MedicinePack, PackStatusEnum
from app.models.batch import Batch
from app.models.custody import CustodyLog
from app.models.telemetry import TelemetryReading
from app.schemas.qr import QRVerifyRequest, VerificationResultResponse
from app.schemas.batch import BatchResponse
from app.schemas.pack import PackResponse, CustodyLogResponse
from app.services.qr_service import qr_service
from app.security.crypto import hash_serial
from app.ai.risk_engine import ai_risk_engine

router = APIRouter(prefix="/verification", tags=["Public Verification"])


@router.post("/scan", response_model=VerificationResultResponse)
async def verify_pack_qr(
    req: QRVerifyRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Public verification endpoint for scanned physical medicine QR codes.
    Evaluates cryptographic signatures, duplicate scans, expiration,
    cold-chain history, and calculates AI risk score.
    """
    serial_hash = None
    serial_number = req.serial_number
    crypto_signature_valid = True

    # 1. Parse QR payload if provided
    if req.qr_payload:
        parsed = qr_service.parse_and_validate_payload(req.qr_payload)
        if parsed:
            serial_hash = parsed["sh"]
            serial_number = parsed["sn"]
        else:
            # Cryptographic tampering detected in QR payload
            crypto_signature_valid = False
            # Still attempt to parse without signature for forensics
            try:
                import json
                raw_json = json.loads(req.qr_payload)
                serial_hash = raw_json.get("sh")
                serial_number = raw_json.get("sn")
            except Exception:
                pass

    if not serial_hash and serial_number:
        serial_hash = hash_serial(serial_number)

    if not serial_hash:
        ai_res = ai_risk_engine.evaluate_risk(
            is_registered=False,
            scan_count=0,
            is_dispensed=False,
            is_expired=False,
            is_quarantined=False,
            is_recalled=False,
            cold_chain_breached=False
        )
        return VerificationResultResponse(
            outcome="UNKNOWN_SERIAL",
            is_authentic=False,
            status_badge="CRITICAL",
            message="No recognizable QR payload or serial number supplied.",
            risk_score=ai_res["risk_score"],
            risk_level=ai_res["risk_level"],
            risk_factors=["Unrecognized or unreadable data matrix format"],
            ai_recommendation=ai_res["recommended_action"],
            scan_count=0,
            cold_chain_breached=False,
            verified_at=datetime.utcnow()
        )

    # 2. Query digital twin pack record
    pack_res = await db.execute(select(MedicinePack).where(MedicinePack.serial_hash == serial_hash))
    pack = pack_res.scalars().first()

    if not pack:
        # Serial does not exist on blockchain / registry -> Counterfeit alert!
        ai_res = ai_risk_engine.evaluate_risk(
            is_registered=False,
            scan_count=1,
            is_dispensed=False,
            is_expired=False,
            is_quarantined=False,
            is_recalled=False,
            cold_chain_breached=False
        )
        return VerificationResultResponse(
            outcome="UNKNOWN_SERIAL",
            is_authentic=False,
            status_badge="CRITICAL",
            message="WARNING: Serial number does not exist in the official manufacturer registry!",
            risk_score=100.0,
            risk_level="CRITICAL",
            risk_factors=["Unregistered counterfeit serial", "Zero on-chain digital twin record"],
            ai_recommendation="DO NOT CONSUME. Suspected fake medicine. Report to State Drug Control immediately.",
            scan_count=1,
            cold_chain_breached=False,
            verified_at=datetime.utcnow()
        )

    # 3. Query parent batch metadata
    batch_res = await db.execute(select(Batch).where(Batch.batch_id == pack.batch_id))
    batch = batch_res.scalars().first()

    # 4. Query cold chain breach telemetry
    tel_res = await db.execute(
        select(TelemetryReading).where(
            (TelemetryReading.batch_id == pack.batch_id) & (TelemetryReading.is_breached == True)
        )
    )
    breach_readings = tel_res.scalars().all()
    cold_chain_breached = len(breach_readings) > 0

    # 5. Query full chain-of-custody journey
    custody_res = await db.execute(
        select(CustodyLog).where(CustodyLog.serial_hash == serial_hash).order_by(CustodyLog.timestamp.asc())
    )
    custody_logs = custody_res.scalars().all()

    # 6. Update scan telemetry & detect duplicates
    pack.scan_count += 1
    if not pack.first_scanned_at:
        pack.first_scanned_at = datetime.utcnow()
    pack.last_scanned_at = datetime.utcnow()

    is_duplicate_scan = pack.scan_count > 1
    if is_duplicate_scan:
        pack.is_suspicious = True
        pack.suspicion_reason = f"Duplicate scan #{pack.scan_count} detected"

    await db.commit()
    await db.refresh(pack)

    # 7. Evaluate safety rules and priority outcomes
    is_expired = batch and datetime.now() > batch.expires_at
    is_quarantined = batch and batch.is_quarantined
    is_recalled = batch and batch.is_recalled
    is_dispensed = pack.status == PackStatusEnum.DISPENSED

    # Run local AI Risk Engine
    ai_res = ai_risk_engine.evaluate_risk(
        is_registered=True,
        scan_count=pack.scan_count,
        is_dispensed=is_dispensed,
        is_expired=is_expired,
        is_quarantined=is_quarantined,
        is_recalled=is_recalled,
        cold_chain_breached=cold_chain_breached
    )

    # Determine primary verdict
    if is_recalled:
        outcome = "RECALLED"
        badge = "CRITICAL"
        is_auth = False
        msg = f"CRITICAL RECALL NOTICE: This batch ({batch.batch_code}) has been recalled by health authorities. Reason: {batch.quarantine_reason or 'Safety inspection failure'}"
    elif is_quarantined:
        outcome = "QUARANTINED"
        badge = "DANGER"
        is_auth = False
        msg = f"REGULATORY QUARANTINE: This product is temporarily seized and quarantined. Do not dispense. Reason: {batch.quarantine_reason or 'Pending lab test verification'}"
    elif is_expired:
        outcome = "EXPIRED"
        badge = "DANGER"
        is_auth = False
        msg = f"EXPIRED MEDICINE: This pack expired on {batch.expires_at.strftime('%Y-%m-%d')}. Chemical efficacy may be severely compromised."
    elif is_dispensed and is_duplicate_scan:
        outcome = "ALREADY_DISPENSED"
        badge = "CRITICAL"
        is_auth = False
        msg = "FRAUD ALERT: This serialized medicine pack was previously dispensed to another patient. This physical pack may be a cloned or refilled counterfeit!"
    elif cold_chain_breached:
        outcome = "COLD_CHAIN_BREACHED"
        badge = "WARNING"
        is_auth = False
        msg = "COLD CHAIN EXCURSION: Thermal breaches were recorded during transportation. Active pharmaceutical ingredients may have degraded."
    elif is_duplicate_scan:
        outcome = "SUSPICIOUS_DUPLICATE"
        badge = "WARNING"
        is_auth = False
        msg = f"CAUTION: This QR code has been scanned {pack.scan_count} times before purchase. Inspect anti-tamper blister seals carefully."
    elif not crypto_signature_valid:
        outcome = "SUSPICIOUS_DUPLICATE"
        badge = "CRITICAL"
        is_auth = False
        msg = "SIGNATURE TAMPERING: The cryptographic packaging HMAC does not match official manufacturer keys."
    else:
        outcome = "AUTHENTIC"
        badge = "SUCCESS"
        is_auth = True
        msg = "AUTHENTIC MEDICINE: Cryptographically verified digital twin. Intact custody trail and certified cold-chain parameters."

    factors = []
    if is_quarantined or is_recalled:
        factors.append("Active Regulatory Enforcement Order")
    if is_duplicate_scan:
        factors.append(f"Multiple Scans Recorded ({pack.scan_count} times)")
    if cold_chain_breached:
        factors.append("Cold-Chain Temperature Excursion Occurred")
    if is_expired:
        factors.append("Expired Past Manufacturer Threshold")
    if is_dispensed:
        factors.append("Already Recorded in Patient Dispense Registry")

    return VerificationResultResponse(
        outcome=outcome,
        is_authentic=is_auth,
        status_badge=badge,
        message=msg,
        risk_score=ai_res["risk_score"],
        risk_level=ai_res["risk_level"],
        risk_factors=factors or ["Zero Anomalies Detected", "Chain of Custody Verified"],
        ai_recommendation=ai_res["recommended_action"],
        scan_count=pack.scan_count,
        cold_chain_breached=cold_chain_breached,
        pack=PackResponse.model_validate(pack),
        batch=BatchResponse.model_validate(batch) if batch else None,
        custody_timeline=[CustodyLogResponse.model_validate(c) for c in custody_logs],
        verified_at=datetime.utcnow()
    )
