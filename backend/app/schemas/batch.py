"""
Batch Management Schemas
"""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class BatchCreate(BaseModel):
    batch_code: str = Field(..., description="Human-readable batch identifier, e.g., BATCH-VAC-2026-01")
    product_code: str = Field(..., description="GTIN / SKU / NDC code")
    brand_name: str
    generic_name: str
    dosage_form: str
    strength: str
    total_packs: int = Field(gt=0)
    min_temp: float = Field(..., description="Minimum safe temperature in Celsius")
    max_temp: float = Field(..., description="Maximum safe temperature in Celsius")
    max_excursion_seconds: int = 3600
    expires_at: datetime


class BatchResponse(BaseModel):
    id: int
    batch_id: str
    batch_code: str
    product_code: str
    brand_name: str
    generic_name: str
    dosage_form: str
    strength: str
    total_packs: int
    packs_registered: int
    min_temp: float
    max_temp: float
    manufactured_at: datetime
    expires_at: datetime
    manufacturer_address: str
    on_chain_tx_hash: Optional[str] = None
    is_quarantined: bool
    is_recalled: bool
    quarantine_reason: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
