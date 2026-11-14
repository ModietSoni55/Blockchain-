"""
MedSupply Sentinel - Application Configuration
Configured using Pydantic Settings with local environment fallbacks.
100% Free & Open-Source (Zero Paid Keys or Services Required)
"""

from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Application Environment
    APP_NAME: str = "MedSupply Sentinel Backend API"
    APP_ENV: str = "development"
    DEBUG: bool = True
    PORT: int = 8000
    HOST: str = "0.0.0.0"
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Database Settings (Local SQLite)
    DATABASE_URL: str = "sqlite+aiosqlite:///./medsupply_sentinel.db"
    SYNC_DATABASE_URL: str = "sqlite:///./medsupply_sentinel.db"

    # Cryptographic & JWT Security
    SECRET_KEY: str = "medsupply-sentinel-ultra-secure-local-jwt-signing-key-change-in-prod"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # QR Cryptographic HMAC Attestation
    QR_HMAC_SECRET: str = "super-secret-hmac-key-for-qr-attestation-signing-entropy"
    QR_NONCE_TTL_SECONDS: int = 86400

    # Local Blockchain (Anvil node)
    BLOCKCHAIN_RPC_URL: str = "http://127.0.0.1:8545"
    CHAIN_ID: int = 31337

    # Smart Contract Deployments
    MEDSUPPLY_SENTINEL_ADDRESS: str = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
    MEDICINE_PACK_NFT_ADDRESS: str = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
    COLD_CHAIN_ORACLE_ADDRESS: str = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
    QR_ATTESTATION_ADDRESS: str = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
    REGULATOR_GOVERNANCE_ADDRESS: str = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"

    # Local Signer Account (Anvil Account #0 for backend transactions)
    BACKEND_OPERATOR_PRIVATE_KEY: str = (
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    )

    # Local Machine Learning Risk Engine
    AI_RISK_THRESHOLD_HIGH: float = 75.0
    AI_RISK_THRESHOLD_CRITICAL: float = 90.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


settings = Settings()
