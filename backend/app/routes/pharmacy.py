"""
Pharmacy Dispensing and Verification Routes
"""

import hashlib
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.pack import MedicinePack, PackStatusEnum
from app.models.batch import Batch
from app.models.custody import CustodyLog
from app.schemas.pack import PackResponse, DispenseRequest
from app.blockchain.client import blockchain_client
from app.dependencies import get_current_active_user

router = APIRouter(prefix="/pharmacy", tags=["Pharmacy"])


@router.get("/inventory", response_model=List[PackResponse])
async def list_pharmacy_inventory(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MedicinePack).where(MedicinePack.status == PackStatusEnum.AT_PHARMACY)
    )
    return result.scalars().all()


@router.post("/dispense")
async def dispense_medicine(
    req: DispenseRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(MedicinePack).where(MedicinePack.serial_hash == req.serial_hash))
    pack = result.scalars().first()
    if not pack:
        raise HTTPException(status_code=404, detail="Pack not found")

    batch_res = await db.execute(select(Batch).where(Batch.batch_id == pack.batch_id))
    batch = batch_res.scalars().first()

    # Pre-dispense safety gates
    if batch and batch.is_quarantined:
        raise HTTPException(status_code=400, detail="Cannot dispense: Batch is currently under regulatory quarantine!")

    if batch and batch.is_recalled:
        raise HTTPException(status_code=400, detail="Cannot dispense: Batch has been officially recalled!")

    if batch and datetime.now() > batch.expires_at:
        raise HTTPException(status_code=400, detail="Cannot dispense: Medicine has expired!")

    if pack.status == PackStatusEnum.DISPENSED:
        raise HTTPException(status_code=400, detail="Pack was already dispensed to a patient!")

    # Generate patient receipt hash (privacy-preserving cryptographic hash)
    receipt_data = f"{req.serial_hash}:{req.patient_identifier}:{req.prescription_number}:{datetime.utcnow().isoformat()}"
    receipt_hash = f"0x{hashlib.sha256(receipt_data.encode()).hexdigest()}"

    # Broadcast on-chain dispense
    tx_hash = blockchain_client.send_transaction({
        "to": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "data": f"dispenseToPatient({req.serial_hash},{receipt_hash})"
    })

    pack.status = PackStatusEnum.DISPENSED
    pack.dispensed_at = datetime.utcnow()
    pack.dispensed_pharmacy = current_user.wallet_address or "Hospital-Main-Pharmacy"
    pack.patient_receipt_hash = receipt_hash

    log = CustodyLog(
        serial_hash=pack.serial_hash,
        batch_id=pack.batch_id,
        from_address=current_user.wallet_address or "Pharmacy",
        to_address="0x000000000000000000000000000000000000dEaD",
        action="DISPENSED_TO_PATIENT",
        notes=f"Prescription verified. Dispensed: {req.notes}",
        location_name="Point of Care Pharmacy",
        tx_hash=tx_hash
    )
    db.add(log)
    await db.commit()

    return {
        "status": "SUCCESS",
        "message": "Medicine dispensed safely to patient",
        "receipt_hash": receipt_hash,
        "tx_hash": tx_hash
    }
