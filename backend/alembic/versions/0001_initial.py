"""Initial persistent queue, assets, events and system state."""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "jobs",
        sa.Column("job_id", sa.String(), primary_key=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("spec", sa.JSON(), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("output_asset_ids", sa.JSON(), nullable=False),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("started_at", sa.String()),
        sa.Column("completed_at", sa.String()),
        sa.Column("error_message", sa.Text()),
        sa.Column("retry_of", sa.String()),
    )
    op.create_index("ix_jobs_status", "jobs", ["status"])
    op.create_table(
        "assets",
        sa.Column("asset_id", sa.String(), primary_key=True),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("namespace", sa.String(), nullable=False),
        sa.Column("relative_path", sa.String(), nullable=False, unique=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_assets_job_id", "assets", ["job_id"])
    op.create_index("ix_assets_namespace", "assets", ["namespace"])
    op.create_table(
        "events",
        sa.Column("event_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_events_job_id", "events", ["job_id"])
    op.create_table(
        "system_state",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
    )


def downgrade():
    for name in ("system_state", "events", "assets", "jobs"):
        op.drop_table(name)
