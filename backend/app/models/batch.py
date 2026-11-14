"""
Medicine Batch Database Model
"""

from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    batch_id: Mapped[str] = mapped_column(String(66), unique=True, index=True, nullable=False)
    batch_code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    product_code: Mapped[str] = mapped_column(String(64), index=True, nullable=False)  # GTIN/NDC
    brand_name: Mapped[str] = mapped_column(String(128), nullable=False)
    generic_name: Mapped[str] = mapped_column(String(128), nullable=False)
    dosage_form: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g., Vial, Tablet
    strength: Mapped[str] = mapped_column(String(64), nullable=False)      # e.g., 0.5 mL, 500 mg
    total_packs: Mapped[int] = mapped_column(Integer, nullable=False)
    packs_registered: Mapped[int] = mapped_column(Integer, default=0)

    # Temperature bounds stored in Celsius (e.g. 2.0 to 8.0)
    min_temp: Mapped[float] = mapped_column(Float, nullable=False)
    max_temp: Mapped[float] = mapped_column(Float, nullable=False)
    max_excursion_seconds: Mapped[int] = mapped_column(Integer, default=3600)

    manufactured_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    manufacturer_address: Mapped[str] = mapped_column(String(42), nullable=False, index=True)

    # On-Chain State
    on_chain_tx_hash: Mapped[str] = mapped_column(String(66), nullable=True)
    is_quarantined: Mapped[bool] = mapped_column(Boolean, default=False)
    is_recalled: Mapped[bool] = mapped_column(Boolean, default=False)
    quarantine_reason: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
