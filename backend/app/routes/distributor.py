"""
Distributor Operations & IoT Telemetry Ingestion Routes
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.pack import MedicinePack, PackStatusEnum
from app.models.batch import Batch
from app.models.custody import CustodyLog
from app.models.telemetry import TelemetryReading
from app.schemas.pack import PackResponse, CustodyTransferRequest
from app.schemas.telemetry import TelemetryCreate, TelemetryResponse
from app.services.telemetry_service import telemetry_service
from app.blockchain.client import blockchain_client
from app.dependencies import get_current_active_user

router = APIRouter(prefix="/distributor", tags=["Distributor"])


@router.get("/inventory", response_model=List[PackResponse])
async def list_distributor_inventory(
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(MedicinePack).where(MedicinePack.status == PackStatusEnum.IN_TRANSIT)
    )
    return result.scalars().all()


@router.post("/dispatch-to-pharmacy")
async def dispatch_to_pharmacy(
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
        "data": f"transferToPharmacy({req.serial_hash})"
    })

    pack.status = PackStatusEnum.AT_PHARMACY
    pack.current_custodian = req.recipient_address

    log = CustodyLog(
        serial_hash=pack.serial_hash,
        batch_id=pack.batch_id,
        from_address=sender,
        to_address=req.recipient_address,
        action="TRANSFER_PHARMACY",
        notes=req.notes or "Delivered and verified at hospital pharmacy receiving dock",
        location_name=req.location_name or "Hospital Pharmacy Warehouse",
        tx_hash=tx_hash
    )
    db.add(log)
    await db.commit()
    return {"status": "SUCCESS", "message": "Pack delivered to pharmacy", "tx_hash": tx_hash}


@router.post("/telemetry", response_model=TelemetryResponse)
async def record_iot_telemetry(
    tel_in: TelemetryCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Ingests live or simulated IoT sensor data.
    Validates against batch temperature bounds and records excursions.
    """
    batch_res = await db.execute(select(Batch).where(Batch.batch_id == tel_in.batch_id))
    batch = batch_res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    is_breached, breach_type = telemetry_service.evaluate_reading(batch, tel_in.temperature)

    tx_hash = None
    if is_breached:
        # Trigger on-chain breach alarm
        tx_hash = blockchain_client.send_transaction({
            "to": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
            "data": f"recordTelemetry({tel_in.batch_id},{int(tel_in.temperature*100)})"
        })

    reading = TelemetryReading(
        batch_id=tel_in.batch_id,
        temperature=tel_in.temperature,
        humidity=tel_in.humidity,
        latitude=tel_in.latitude,
        longitude=tel_in.longitude,
        device_id=tel_in.device_id,
        is_breached=is_breached,
        breach_type=breach_type,
        on_chain_tx_hash=tx_hash
    )
    db.add(reading)
    await db.commit()
    await db.refresh(reading)
    return reading


@router.get("/telemetry/{batch_id}", response_model=List[TelemetryResponse])
async def get_batch_telemetry(
    batch_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(TelemetryReading)
        .where(TelemetryReading.batch_id == batch_id)
        .order_by(TelemetryReading.timestamp.desc())
        .limit(100)
    )
    return result.scalars().all()
