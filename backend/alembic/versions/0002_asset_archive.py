"""Add recoverable asset archive state."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("assets", sa.Column("archived_at", sa.String(), nullable=True))
    op.create_index("ix_assets_archived_at", "assets", ["archived_at"])


def downgrade():
    op.drop_index("ix_assets_archived_at", table_name="assets")
    op.drop_column("assets", "archived_at")
