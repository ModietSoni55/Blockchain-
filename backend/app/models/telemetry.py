"""
Cold-Chain IoT Telemetry Log Model
"""

from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TelemetryReading(Base):
    __tablename__ = "telemetry_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    batch_id: Mapped[str] = mapped_column(String(66), index=True, nullable=False)
    temperature: Mapped[float] = mapped_column(Float, nullable=False)
    humidity: Mapped[float] = mapped_column(Float, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    is_breached: Mapped[bool] = mapped_column(Boolean, default=False)
    breach_type: Mapped[str] = mapped_column(String(32), nullable=True)  # OVERHEATING, SUBCOOLING, NONE
    on_chain_tx_hash: Mapped[str] = mapped_column(String(66), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
