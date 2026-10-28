import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Integer, String, Text, create_engine, event, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid4().hex


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"
    job_id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    status: Mapped[str] = mapped_column(String, index=True, default="queued")
    priority: Mapped[int] = mapped_column(Integer, default=0)
    spec: Mapped[dict] = mapped_column(JSON)
    items: Mapped[list] = mapped_column(JSON, default=list)
    output_asset_ids: Mapped[list] = mapped_column(JSON, default=list)
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[str] = mapped_column(String, default=now)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_of: Mapped[str | None] = mapped_column(String, nullable=True)


class Asset(Base):
    __tablename__ = "assets"
    asset_id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    job_id: Mapped[str] = mapped_column(String, index=True)
    namespace: Mapped[str] = mapped_column(String, index=True)
    relative_path: Mapped[str] = mapped_column(String, unique=True)
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=now)
    archived_at: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


class Event(Base):
    __tablename__ = "events"
    event_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String, index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=now)


class State(Base):
    __tablename__ = "system_state"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class PixelProject(Base):
    __tablename__ = "pixel_projects"
    project_id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String, unique=True)
    art_bible: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class PixelAsset(Base):
    __tablename__ = "pixel_assets"
    asset_id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(String, index=True)
    kind: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    source_asset_id: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="draft")
    approved_version_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)
    archived_at: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


class PixelVersion(Base):
    __tablename__ = "pixel_versions"
    version_id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    asset_id: Mapped[str] = mapped_column(String, index=True)
    relative_path: Mapped[str] = mapped_column(String, unique=True)
    operation: Mapped[str] = mapped_column(String)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String, default=now)


def job_dict(job):
    return dict(
        job.spec,
        job_id=job.job_id,
        status=job.status,
        items=job.items,
        output_asset_ids=job.output_asset_ids,
        cancel_requested=job.cancel_requested,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        error_message=job.error_message,
        retry_of=job.retry_of,
    )


def emit(session, job):
    session.flush()
    session.add(Event(job_id=job.job_id, payload=job_dict(job)))


def set_state(session, key, value):
    row = session.get(State, key)
    if row:
        row.value = value
    else:
        session.add(State(key=key, value=value))


class Database:
    def __init__(self, data_dir):
        folder = data_dir / "database"
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.engine = create_engine(
            f"sqlite:///{folder / 'studio.sqlite3'}",
            connect_args={"check_same_thread": False, "timeout": 15},
        )

        @event.listens_for(self.engine, "connect")
        def sqlite_setup(connection, _):
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=15000")

        self.session = sessionmaker(self.engine, expire_on_commit=False)

    def migrate(self):
        from alembic import command
        from alembic.config import Config

        from app.core.config import ROOT

        config = Config()
        config.set_main_option("script_location", str(ROOT / "backend/alembic"))
        with self.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

    def get_state(self, key, default=None):
        with self.session() as session:
            row = session.get(State, key)
            return row.value if row else default

    def state(self, key, value):
        with self.session.begin() as session:
            set_state(session, key, value)

    def recover_jobs(self):
        with self.session.begin() as session:
            for job in session.scalars(
                select(Job).where(Job.status.in_(["running", "waiting_for_gpu"]))
            ):
                job.status = "interrupted"
                job.error_message = "Server stopped before job reached a terminal state"
                job.completed_at = now()
                job.items = [
                    dict(i, status="interrupted") if i["status"] in {"running", "pending"} else i
                    for i in job.items
                ]
                emit(session, job)

    def events(self, job_id, after):
        with self.session() as session:
            return [
                (e.event_id, json.dumps(e.payload, ensure_ascii=False))
                for e in session.scalars(
                    select(Event)
                    .where(Event.job_id == job_id, Event.event_id > after)
                    .order_by(Event.event_id)
                    .limit(100)
                )
            ]
