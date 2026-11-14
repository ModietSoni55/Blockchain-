"""
Regulatory Incidents, Recalls, and Quarantine Logs
"""

import enum
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Boolean, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class IncidentTypeEnum(str, enum.Enum):
    QUARANTINE = "QUARANTINE"
    RECALL = "RECALL"
    SECURITY_FLAG = "SECURITY_FLAG"


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    incident_type: Mapped[IncidentTypeEnum] = mapped_column(Enum(IncidentTypeEnum), nullable=False)
    target_id: Mapped[str] = mapped_column(String(66), index=True, nullable=False)  # batch_id or serial_hash
    is_pack: Mapped[bool] = mapped_column(Boolean, default=False)
    severity: Mapped[str] = mapped_column(String(32), default="MEDIUM")  # CLASS_I, CLASS_II, CLASS_III, WARNING
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    authority_address: Mapped[str] = mapped_column(String(42), nullable=False)
    on_chain_tx_hash: Mapped[str] = mapped_column(String(66), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
