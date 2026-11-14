"""
System-Wide Analytics and Supply-Chain KPI Dashboard Routes
"""

from typing import Dict, Any, List
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.batch import Batch
from app.models.pack import MedicinePack, PackStatusEnum
from app.models.telemetry import TelemetryReading
from app.models.custody import CustodyLog
from app.models.incident import Incident

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/overview")
async def get_system_overview(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    batches_count = await db.scalar(select(func.count(Batch.id))) or 0
    packs_count = await db.scalar(select(func.count(MedicinePack.id))) or 0
    dispensed_count = await db.scalar(
        select(func.count(MedicinePack.id)).where(MedicinePack.status == PackStatusEnum.DISPENSED)
    ) or 0
    quarantined_count = await db.scalar(
        select(func.count(Batch.id)).where(Batch.is_quarantined == True)
    ) or 0
    breaches_count = await db.scalar(
        select(func.count(TelemetryReading.id)).where(TelemetryReading.is_breached == True)
    ) or 0
    suspicious_count = await db.scalar(
        select(func.count(MedicinePack.id)).where(MedicinePack.is_suspicious == True)
    ) or 0

    return {
        "total_batches": batches_count,
        "total_packs": packs_count,
        "total_dispensed": dispensed_count,
        "active_quarantines": quarantined_count,
        "cold_chain_breaches": breaches_count,
        "suspicious_packs": suspicious_count,
        "integrity_rate_percentage": round(
            ((packs_count - suspicious_count) / max(packs_count, 1)) * 100.0, 1
        )
    }


@router.get("/recent-activity")
async def get_recent_activity(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CustodyLog).order_by(CustodyLog.timestamp.desc()).limit(15)
    )
    logs = result.scalars().all()
    return logs
