"""
Serialized Medicine Pack Model
"""

import enum
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Boolean, Enum, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PackStatusEnum(str, enum.Enum):
    MANUFACTURED = "MANUFACTURED"
    IN_TRANSIT = "IN_TRANSIT"
    AT_PHARMACY = "AT_PHARMACY"
    DISPENSED = "DISPENSED"
    QUARANTINED = "QUARANTINED"
    RECALLED = "RECALLED"


class MedicinePack(Base):
    __tablename__ = "medicine_packs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    serial_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    serial_hash: Mapped[str] = mapped_column(String(66), unique=True, index=True, nullable=False)
    batch_id: Mapped[str] = mapped_column(String(66), ForeignKey("batches.batch_id"), index=True, nullable=False)
    token_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=True)

    status: Mapped[PackStatusEnum] = mapped_column(
        Enum(PackStatusEnum), default=PackStatusEnum.MANUFACTURED, nullable=False
    )
    current_custodian: Mapped[str] = mapped_column(String(42), nullable=False, index=True)

    # Cryptographic attestation fields
    nonce: Mapped[str] = mapped_column(String(66), nullable=False)
    signature: Mapped[str] = mapped_column(Text, nullable=False)
    qr_data_uri: Mapped[str] = mapped_column(Text, nullable=False)

    # Verification and Anti-Counterfeit flags
    scan_count: Mapped[int] = mapped_column(Integer, default=0)
    is_suspicious: Mapped[bool] = mapped_column(Boolean, default=False)
    suspicion_reason: Mapped[str] = mapped_column(Text, nullable=True)
    first_scanned_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    last_scanned_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    # Patient dispensing
    dispensed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    dispensed_pharmacy: Mapped[str] = mapped_column(String(42), nullable=True)
    patient_receipt_hash: Mapped[str] = mapped_column(String(66), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
