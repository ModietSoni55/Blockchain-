"""
Authentication and Identity Routes
Supports username/password and Web3 wallet challenge/response.
"""

from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.config import settings
from app.models.user import User, RoleEnum
from app.schemas.auth import (
    UserCreate,
    UserLogin,
    UserResponse,
    Token,
    WalletChallenge,
    WalletVerify
)
from app.security.crypto import (
    get_password_hash,
    verify_password,
    create_access_token,
    verify_wallet_signature,
    generate_secure_nonce
)
from app.dependencies import get_current_active_user

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    # Check if username or email exists
    result = await db.execute(
        select(User).where((User.username == user_in.username) | (User.email == user_in.email))
    )
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Username or email already registered")

    new_user = User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        organization_name=user_in.organization_name,
        role=user_in.role,
        wallet_address=user_in.wallet_address.lower() if user_in.wallet_address else None
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.post("/login", response_model=Token)
async def login(credentials: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == credentials.username))
    user = result.scalars().first()
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )

    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value, "wallet": user.wallet_address}
    )
    return Token(access_token=access_token, user=UserResponse.model_validate(user))


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_active_user)):
    return current_user


@router.post("/wallet/challenge", response_model=WalletChallenge)
async def get_wallet_challenge(wallet_address: str):
    """Generates an EIP-191 challenge string with a secure nonce."""
    nonce = generate_secure_nonce()
    challenge_message = (
        f"MedSupply Sentinel Authentication\n"
        f"Wallet: {wallet_address.lower()}\n"
        f"Nonce: {nonce}\n"
        f"Sign this message to prove ownership without paying any gas fees."
    )
    return WalletChallenge(
        wallet_address=wallet_address.lower(),
        challenge_message=challenge_message,
        nonce=nonce
    )


@router.post("/wallet/verify", response_model=Token)
async def verify_wallet(verify_in: WalletVerify, db: AsyncSession = Depends(get_db)):
    """Verifies cryptographic wallet signature and returns JWT."""
    challenge_message = (
        f"MedSupply Sentinel Authentication\n"
        f"Wallet: {verify_in.wallet_address.lower()}\n"
        f"Nonce: {verify_in.nonce}\n"
        f"Sign this message to prove ownership without paying any gas fees."
    )

    is_valid = verify_wallet_signature(
        address=verify_in.wallet_address,
        message=challenge_message,
        signature=verify_in.signature
    )
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid cryptographic signature")

    # Find or auto-provision wallet participant
    result = await db.execute(
        select(User).where(User.wallet_address == verify_in.wallet_address.lower())
    )
    user = result.scalars().first()

    if not user:
        # Default registration for wallet in demo mode
        user = User(
            username=f"wallet_{verify_in.wallet_address[:8]}",
            email=f"{verify_in.wallet_address[:8]}@medsupply.local",
            hashed_password=get_password_hash("WalletUserPassword123!"),
            organization_name="Web3 Participant",
            role=RoleEnum.MANUFACTURER,
            wallet_address=verify_in.wallet_address.lower()
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value, "wallet": user.wallet_address}
    )
    return Token(access_token=access_token, user=UserResponse.model_validate(user))
