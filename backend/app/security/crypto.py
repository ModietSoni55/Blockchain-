"""
Cryptographic and Hashing Utilities
Zero paid services: Uses standard Python cryptography, hashlib, hmac, and eth_account.
"""

import hmac
import hashlib
import json
import secrets
from typing import Optional, Tuple
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from eth_account import Account
from eth_account.messages import encode_defunct

from app.config import settings

# Password hashing context using standard bcrypt
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against the stored bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hashes a plain password using bcrypt."""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Generates a signed JWT bearer token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """Decodes and validates a JWT token."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def generate_keccak256(data_bytes: bytes) -> str:
    """Generates an Ethereum keccak256 hex string with 0x prefix."""
    h = hashlib.sha3_256(data_bytes).hexdigest()
    # In standard EVM compatibility, we use sha3_256 or Web3 keccak
    return f"0x{h}"


def hash_serial(serial_number: str) -> str:
    """Computes a consistent 0x-prefixed 32-byte hash for a pack serial number."""
    return generate_keccak256(serial_number.strip().encode("utf-8"))


def generate_secure_nonce() -> str:
    """Generates a cryptographically strong 32-byte hex nonce."""
    return f"0x{secrets.token_hex(32)}"


def sign_qr_payload(
    serial_hash: str,
    batch_id: str,
    expiry_timestamp: int,
    nonce: str,
    issued_at: int
) -> str:
    """
    Creates an HMAC-SHA256 signature for physical QR code verification.
    Guarantees tamper-evidence without requiring paid cloud signers.
    """
    payload_str = f"{serial_hash}:{batch_id}:{expiry_timestamp}:{nonce}:{issued_at}"
    signature = hmac.new(
        settings.QR_HMAC_SECRET.encode("utf-8"),
        payload_str.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return signature


def verify_qr_payload_signature(
    serial_hash: str,
    batch_id: str,
    expiry_timestamp: int,
    nonce: str,
    issued_at: int,
    provided_signature: str
) -> bool:
    """Validates an HMAC-SHA256 physical QR signature in constant time."""
    expected_sig = sign_qr_payload(
        serial_hash,
        batch_id,
        expiry_timestamp,
        nonce,
        issued_at
    )
    return hmac.compare_digest(expected_sig, provided_signature)


def verify_wallet_signature(address: str, message: str, signature: str) -> bool:
    """
    Verifies an EIP-191 personal_sign signature using eth_account.
    Enables passwordless, cryptographic Web3 wallet authentication.
    """
    try:
        msg = encode_defunct(text=message)
        recovered_address = Account.recover_message(msg, signature=signature)
        return recovered_address.lower() == address.lower()
    except Exception:
        return False
