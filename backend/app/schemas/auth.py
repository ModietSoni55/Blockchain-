"""
Authentication and User Pydantic Schemas
"""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, EmailStr
from app.models.user import RoleEnum


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    organization_name: str
    role: RoleEnum
    wallet_address: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    organization_name: str
    role: RoleEnum
    wallet_address: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[RoleEnum] = None
    wallet_address: Optional[str] = None


class WalletChallenge(BaseModel):
    wallet_address: str
    challenge_message: str
    nonce: str


class WalletVerify(BaseModel):
    wallet_address: str
    signature: str
    nonce: str
