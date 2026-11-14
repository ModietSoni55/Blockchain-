"""
Regulatory Oversight, Emergency Quarantine & Product Recall API
"""

from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.batch import Batch
from app.models.incident import Incident, IncidentTypeEnum
from app.blockchain.client import blockchain_client
from app.dependencies import get_current_active_user

router = APIRouter(prefix="/regulator", tags=["Regulator"])


class QuarantineRequest(BaseModel):
    batch_id: str
    reason: str
    severity: str = "CLASS_I"


class RecallRequest(BaseModel):
    batch_id: str
    reason: str
    severity: str = "CLASS_I"
    public_notice_uri: Optional[str] = "https://fda.gov/recalls/sample-notice"


@router.post("/quarantine")
async def issue_quarantine(
    req: QuarantineRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    batch_res = await db.execute(select(Batch).where(Batch.batch_id == req.batch_id))
    batch = batch_res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    auth_addr = current_user.wallet_address or "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
    tx_hash = blockchain_client.send_transaction({
        "to": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
        "data": f"quarantine({req.batch_id})"
    })

    batch.is_quarantined = True
    batch.quarantine_reason = req.reason

    incident = Incident(
        incident_type=IncidentTypeEnum.QUARANTINE,
        target_id=req.batch_id,
        is_pack=False,
        severity=req.severity,
        reason=req.reason,
        authority_address=auth_addr,
        on_chain_tx_hash=tx_hash
    )
    db.add(incident)
    await db.commit()

    return {
        "status": "SUCCESS",
        "message": f"Batch {batch.batch_code} has been successfully quarantined",
        "tx_hash": tx_hash
    }


@router.post("/lift-quarantine")
async def lift_quarantine(
    batch_id: str,
    justification: str = "Remediation verified; lab sample cleared",
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    batch_res = await db.execute(select(Batch).where(Batch.batch_id == batch_id))
    batch = batch_res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch.is_quarantined = False
    batch.quarantine_reason = None

    # Resolve active incidents
    incidents_res = await db.execute(
        select(Incident).where(
            (Incident.target_id == batch_id) & (Incident.is_active == True)
        )
    )
    for inc in incidents_res.scalars().all():
        inc.is_active = False
        inc.resolved_at = datetime.utcnow()

    await db.commit()
    return {"status": "SUCCESS", "message": f"Quarantine lifted for batch {batch.batch_code}"}


@router.post("/recall")
async def issue_recall(
    req: RecallRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    batch_res = await db.execute(select(Batch).where(Batch.batch_id == req.batch_id))
    batch = batch_res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    auth_addr = current_user.wallet_address or "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
    tx_hash = blockchain_client.send_transaction({
        "to": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
        "data": f"issueRecall({req.batch_id})"
    })

    batch.is_recalled = True
    batch.quarantine_reason = req.reason

    incident = Incident(
        incident_type=IncidentTypeEnum.RECALL,
        target_id=req.batch_id,
        is_pack=False,
        severity=req.severity,
        reason=req.reason,
        authority_address=auth_addr,
        on_chain_tx_hash=tx_hash
    )
    db.add(incident)
    await db.commit()

    return {
        "status": "SUCCESS",
        "message": f"Class {req.severity} Recall broadcasted globally for batch {batch.batch_code}",
        "tx_hash": tx_hash
    }
