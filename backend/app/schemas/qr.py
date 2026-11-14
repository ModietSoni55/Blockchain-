"""
QR Verification and Attestation Schemas
"""

from typing import Optional, List, Dict
from datetime import datetime
from pydantic import BaseModel
from app.schemas.batch import BatchResponse
from app.schemas.pack import PackResponse, CustodyLogResponse


class QRAttestationPayload(BaseModel):
    serial_number: str
    serial_hash: str
    batch_id: str
    expiry_timestamp: int
    nonce: str
    issued_at: int
    signature: str


class QRVerifyRequest(BaseModel):
    qr_payload: Optional[str] = None
    serial_number: Optional[str] = None
    scanner_latitude: Optional[float] = None
    scanner_longitude: Optional[float] = None
    scanner_device: Optional[str] = "Mobile-Web-Client"


class VerificationResultResponse(BaseModel):
    outcome: str  # AUTHENTIC, EXPIRED, ALREADY_DISPENSED, QUARANTINED, RECALLED, COLD_CHAIN_BREACHED, SUSPICIOUS_DUPLICATE, UNKNOWN_SERIAL
    is_authentic: bool
    status_badge: str  # SUCCESS, WARNING, DANGER, CRITICAL
    message: str
    risk_score: float  # 0.0 to 100.0 from Scikit-Learn AI engine
    risk_level: str    # LOW, MEDIUM, HIGH, CRITICAL
    risk_factors: List[str]
    ai_recommendation: str
    scan_count: int
    cold_chain_breached: bool
    pack: Optional[PackResponse] = None
    batch: Optional[BatchResponse] = None
    custody_timeline: List[CustodyLogResponse] = []
    verified_at: datetime
