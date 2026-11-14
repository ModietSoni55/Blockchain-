"""
Custody Transfer Log Model
"""

from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class CustodyLog(Base):
    __tablename__ = "custody_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    serial_hash: Mapped[str] = mapped_column(String(66), index=True, nullable=False)
    batch_id: Mapped[str] = mapped_column(String(66), index=True, nullable=False)
    from_address: Mapped[str] = mapped_column(String(42), nullable=False)
    to_address: Mapped[str] = mapped_column(String(42), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)  # MINT, TRANSFER_DISTRIBUTOR, TRANSFER_PHARMACY, DISPENSE
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    location_name: Mapped[str] = mapped_column(String(128), nullable=True)
    tx_hash: Mapped[str] = mapped_column(String(66), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
