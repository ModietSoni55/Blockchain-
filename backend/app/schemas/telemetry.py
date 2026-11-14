"""
IoT Sensor Telemetry Schemas
"""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class TelemetryCreate(BaseModel):
    batch_id: str
    temperature: float = Field(..., description="Temperature in Celsius (e.g. 4.5)")
    humidity: float = Field(default=55.0, description="Relative humidity in percentage (e.g. 55.0)")
    latitude: float = Field(default=40.7128, description="GPS Latitude")
    longitude: float = Field(default=-74.0060, description="GPS Longitude")
    device_id: str = Field(default="IOT-RIG-001")


class TelemetryResponse(BaseModel):
    id: int
    batch_id: str
    temperature: float
    humidity: float
    latitude: float
    longitude: float
    device_id: str
    is_breached: bool
    breach_type: Optional[str]
    on_chain_tx_hash: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True
