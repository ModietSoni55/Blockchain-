"""
Role-Based Access Control (RBAC) Module
"""

from typing import List
from fastapi import HTTPException, status
from app.models.user import RoleEnum, User


class RoleChecker:
    """FastAPI route dependency to enforce required user roles."""

    def __init__(self, allowed_roles: List[RoleEnum]):
        self.allowed_roles = allowed_roles

    def __call__(self, user: User) -> User:
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Inactive user account"
            )
        # Super-admin has universal override
        if user.role == RoleEnum.ADMIN:
            return user

        if user.role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[r.value for r in self.allowed_roles]}"
            )
        return user


# Preset role checkers
require_manufacturer = RoleChecker([RoleEnum.MANUFACTURER])
require_distributor = RoleChecker([RoleEnum.DISTRIBUTOR])
require_pharmacy = RoleChecker([RoleEnum.PHARMACY])
require_regulator = RoleChecker([RoleEnum.REGULATOR])
require_admin = RoleChecker([RoleEnum.ADMIN])
require_supply_chain_participant = RoleChecker([
    RoleEnum.MANUFACTURER,
    RoleEnum.DISTRIBUTOR,
    RoleEnum.PHARMACY,
    RoleEnum.REGULATOR
])
