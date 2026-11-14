"""
Medicine Pack and Custody Schemas
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
from app.models.pack import PackStatusEnum


class PackGenerateRequest(BaseModel):
    batch_id: str
    count: int = Field(gt=0, le=1000, description="Number of unique packs to generate and register")


class PackResponse(BaseModel):
    id: int
    serial_number: str
    serial_hash: str
    batch_id: str
    token_id: Optional[int]
    status: PackStatusEnum
    current_custodian: str
    nonce: str
    qr_data_uri: str
    scan_count: int
    is_suspicious: bool
    suspicion_reason: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class CustodyTransferRequest(BaseModel):
    serial_hash: str
    recipient_address: str
    recipient_name: Optional[str] = None
    location_name: Optional[str] = None
    notes: Optional[str] = "Standard verified supply-chain custody handover"


class DispenseRequest(BaseModel):
    serial_hash: str
    patient_identifier: Optional[str] = "Anonymous-Walk-in"
    prescription_number: Optional[str] = None
    notes: Optional[str] = "Dispensed directly to patient with safety verification"


class CustodyLogResponse(BaseModel):
    id: int
    serial_hash: str
    batch_id: str
    from_address: str
    to_address: str
    action: str
    notes: Optional[str]
    location_name: Optional[str]
    tx_hash: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True
