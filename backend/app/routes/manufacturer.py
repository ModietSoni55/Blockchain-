"""
Manufacturer Operations API Routes
"""

import hashlib
import time
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.batch import Batch
from app.models.pack import MedicinePack, PackStatusEnum
from app.models.custody import CustodyLog
from app.schemas.batch import BatchCreate, BatchResponse
from app.schemas.pack import PackGenerateRequest, PackResponse, CustodyTransferRequest
from app.services.qr_service import qr_service
from app.security.crypto import hash_serial
from app.blockchain.client import blockchain_client
from app.dependencies import get_current_active_user

router = APIRouter(prefix="/manufacturer", tags=["Manufacturer"])


@router.post("/batches", response_model=BatchResponse, status_code=status.HTTP_201_CREATED)
async def create_batch(
    batch_in: BatchCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify batch code unique
    existing = await db.execute(select(Batch).where(Batch.batch_code == batch_in.batch_code))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Batch code already exists")

    # Generate 0x-prefixed 32-byte batchId
    batch_id = f"0x{hashlib.sha256(batch_in.batch_code.encode()).hexdigest()}"
    mfg_address = current_user.wallet_address or "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

    # Simulate or broadcast on-chain transaction
    tx_hash = blockchain_client.send_transaction({
        "to": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "data": f"createBatch({batch_id})"
    })

    new_batch = Batch(
        batch_id=batch_id,
        batch_code=batch_in.batch_code,
        product_code=batch_in.product_code,
        brand_name=batch_in.brand_name,
        generic_name=batch_in.generic_name,
        dosage_form=batch_in.dosage_form,
        strength=batch_in.strength,
        total_packs=batch_in.total_packs,
        min_temp=batch_in.min_temp,
        max_temp=batch_in.max_temp,
        max_excursion_seconds=batch_in.max_excursion_seconds,
        expires_at=batch_in.expires_at,
        manufacturer_address=mfg_address,
        on_chain_tx_hash=tx_hash
    )
    db.add(new_batch)
    await db.commit()
    await db.refresh(new_batch)
    return new_batch


@router.get("/batches", response_model=List[BatchResponse])
async def list_batches(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Batch).order_by(Batch.created_at.desc()))
    return result.scalars().all()


@router.post("/packs/generate", response_model=List[PackResponse])
async def generate_packs(
    req: PackGenerateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    # Locate parent batch
    result = await db.execute(select(Batch).where(Batch.batch_id == req.batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    mfg_address = current_user.wallet_address or batch.manufacturer_address
    expiry_ts = int(batch.expires_at.timestamp())
    generated_packs = []

    for i in range(req.count):
        serial_number = f"SN-{batch.batch_code}-{batch.packs_registered + i + 1:05d}"
        serial_hash, nonce, sig, json_payload, data_uri = qr_service.generate_pack_qr_data(
            serial_number=serial_number,
            batch_id=batch.batch_id,
            expiry_timestamp=expiry_ts
        )

        pack = MedicinePack(
            serial_number=serial_number,
            serial_hash=serial_hash,
            batch_id=batch.batch_id,
            token_id=batch.packs_registered + i + 1,
            status=PackStatusEnum.MANUFACTURED,
            current_custodian=mfg_address,
            nonce=nonce,
            signature=sig,
            qr_data_uri=data_uri
        )
        db.add(pack)

        # Log initial custody genesis
        custody = CustodyLog(
            serial_hash=serial_hash,
            batch_id=batch.batch_id,
            from_address="0x0000000000000000000000000000000000000000",
            to_address=mfg_address,
            action="MINT_GENESIS",
            notes=f"Manufactured & sealed at {batch.brand_name} plant",
            location_name="Primary Manufacturing Facility",
            tx_hash=batch.on_chain_tx_hash
        )
        db.add(custody)
        generated_packs.append(pack)

    batch.packs_registered += req.count
    await db.commit()

    for p in generated_packs:
        await db.refresh(p)

    return generated_packs


@router.post("/dispatch-to-distributor")
async def dispatch_to_distributor(
    req: CustodyTransferRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(MedicinePack).where(MedicinePack.serial_hash == req.serial_hash))
    pack = result.scalars().first()
    if not pack:
        raise HTTPException(status_code=404, detail="Pack not found")

    sender = current_user.wallet_address or pack.current_custodian
    tx_hash = blockchain_client.send_transaction({
        "to": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "data": f"transferToDistributor({req.serial_hash})"
    })

    pack.status = PackStatusEnum.IN_TRANSIT
    pack.current_custodian = req.recipient_address

    log = CustodyLog(
        serial_hash=pack.serial_hash,
        batch_id=pack.batch_id,
        from_address=sender,
        to_address=req.recipient_address,
        action="TRANSFER_DISTRIBUTOR",
        notes=req.notes or "Handover to regional cold-storage logistics carrier",
        location_name=req.location_name or "Logistics Depo #1",
        tx_hash=tx_hash
    )
    db.add(log)
    await db.commit()
    return {"status": "SUCCESS", "message": "Custody transferred to distributor", "tx_hash": tx_hash}
