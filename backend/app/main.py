"""
MedSupply Sentinel - FastAPI Application Entrypoint
100% Free & Open-Source. Local SQLite + Local Web3 + Local Scikit-Learn.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.database import init_db, AsyncSessionLocal
from app.models.user import User, RoleEnum
from app.models.batch import Batch
from app.models.pack import MedicinePack, PackStatusEnum
from app.models.custody import CustodyLog
from app.security.crypto import get_password_hash, hash_serial
from app.services.qr_service import qr_service

# Import API Routers
from app.routes.auth import router as auth_router
from app.routes.manufacturer import router as mfg_router
from app.routes.distributor import router as dist_router
from app.routes.pharmacy import router as pharm_router
from app.routes.verification import router as verify_router
from app.routes.regulator import router as reg_router
from app.routes.analytics import router as analytics_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes SQLite database tables and seeds demo participants on startup."""
    await init_db()

    # Seed default demonstration users and initial batches if empty
    async with AsyncSessionLocal() as session:
        user_check = await session.execute(select(User).limit(1))
        if not user_check.scalars().first():
            demo_users = [
                User(
                    username="admin",
                    email="admin@medsupply.local",
                    hashed_password=get_password_hash("Admin123!"),
                    organization_name="MedSupply Sentinel Global Ops",
                    role=RoleEnum.ADMIN,
                    wallet_address="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
                ),
                User(
                    username="pfizer_mfg",
                    email="supply@pfizer-demo.local",
                    hashed_password=get_password_hash("Pfizer123!"),
                    organization_name="Pfizer BioTech Labs",
                    role=RoleEnum.MANUFACTURER,
                    wallet_address="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
                ),
                User(
                    username="apex_distributor",
                    email="logistics@apex-cold.local",
                    hashed_password=get_password_hash("Apex123!"),
                    organization_name="Apex Cold-Chain Logistics",
                    role=RoleEnum.DISTRIBUTOR,
                    wallet_address="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
                ),
                User(
                    username="city_pharmacy",
                    email="rx@cityhospital.local",
                    hashed_password=get_password_hash("CityPharm123!"),
                    organization_name="City Central Hospital Pharmacy",
                    role=RoleEnum.PHARMACY,
                    wallet_address="0x90F79bf6EB2c4f870365E785982E1f101E93b906"
                ),
                User(
                    username="fda_regulator",
                    email="inspector@fda-gov.local",
                    hashed_password=get_password_hash("Regulator123!"),
                    organization_name="National Drug Controller & Regulatory Authority",
                    role=RoleEnum.REGULATOR,
                    wallet_address="0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
                )
            ]
            session.add_all(demo_users)
            await session.commit()

            # Seed a demonstration batch with 5 pre-minted serialized packs
            batch_id = "0x8fa30d418e5b4b1a7d65c3e0984a123f124567890abcdef1234567890abcdef1"
            sample_batch = Batch(
                batch_id=batch_id,
                batch_code="BATCH-PCV-2026",
                product_code="NDC-0069-4210-01",
                brand_name="Prevnar 20 Vaccine",
                generic_name="Pneumococcal 20-valent Conjugate Vaccine",
                dosage_form="Suspension for Injection (Single-dose vial)",
                strength="0.5 mL",
                total_packs=50,
                packs_registered=5,
                min_temp=2.0,
                max_temp=8.0,
                max_excursion_seconds=3600,
                expires_at=datetime.utcnow() + timedelta(days=365),
                manufacturer_address="0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
                on_chain_tx_hash="0x5a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890"
            )
            session.add(sample_batch)
            await session.commit()

            # Create 5 initial packs with authentic QR codes
            for i in range(1, 6):
                sn = f"SN-PCV20-2026-{i:04d}"
                sh, nonce, sig, json_pl, data_uri = qr_service.generate_pack_qr_data(
                    serial_number=sn,
                    batch_id=batch_id,
                    expiry_timestamp=int((datetime.utcnow() + timedelta(days=365)).timestamp())
                )
                pack = MedicinePack(
                    serial_number=sn,
                    serial_hash=sh,
                    batch_id=batch_id,
                    token_id=i,
                    status=PackStatusEnum.AT_PHARMACY if i <= 3 else PackStatusEnum.IN_TRANSIT,
                    current_custodian="0x90F79bf6EB2c4f870365E785982E1f101E93b906" if i <= 3 else "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
                    nonce=nonce,
                    signature=sig,
                    qr_data_uri=data_uri
                )
                session.add(pack)

                # Genesis custody log
                c_log = CustodyLog(
                    serial_hash=sh,
                    batch_id=batch_id,
                    from_address="0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
                    to_address="0x90F79bf6EB2c4f870365E785982E1f101E93b906",
                    action="TRANSFER_PHARMACY",
                    notes="Delivered to Central Pharmacy Cold Room",
                    location_name="Metropolitan Medical Center",
                    tx_hash=sample_batch.on_chain_tx_hash
                )
                session.add(c_log)

            await session.commit()

    yield


app = FastAPI(
    title="MedSupply Sentinel API",
    description="Blockchain Anti-Counterfeit Medicine Traceability, QR Verification, Cold-Chain IoT & AI Risk Scoring",
    version="1.0.0",
    lifespan=lifespan
)

# Configure Cross-Origin Resource Sharing (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register modular routes under /api/v1
app.include_router(auth_router, prefix="/api/v1")
app.include_router(mfg_router, prefix="/api/v1")
app.include_router(dist_router, prefix="/api/v1")
app.include_router(pharm_router, prefix="/api/v1")
app.include_router(verify_router, prefix="/api/v1")
app.include_router(reg_router, prefix="/api/v1")
app.include_router(analytics_router, prefix="/api/v1")


@app.get("/api/health", tags=["Health"])
async def health_check():
    return {
        "status": "HEALTHY",
        "timestamp": datetime.utcnow().isoformat(),
        "database": "SQLite (Local async)",
        "blockchain_rpc": settings.BLOCKCHAIN_RPC_URL,
        "ai_engine": "Scikit-Learn (Local CPU)"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
