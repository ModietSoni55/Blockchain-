"""
MedSupply Sentinel - Database Connection Layer
Asynchronous SQLite connection via SQLAlchemy 2.0 and aiosqlite.
Zero external cloud databases required.
"""

from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine
)
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

# Create asynchronous database engine
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy declarative database models."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that supplies an isolated async database session per request."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Creates database tables automatically on server startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
