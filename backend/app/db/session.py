"""SQLAlchemy 엔진/세션. 워커 스레드에서도 `SessionLocal()` 로 독립 세션을 연다."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.db import models  # noqa: F401  (테이블 등록)

    Base.metadata.create_all(bind=engine)
    # 가벼운 마이그레이션: 나중에 추가된 컬럼
    from sqlalchemy import text

    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS infer_interval_s DOUBLE PRECISION"))
