"""Add recoverable Pixel Asset archive state."""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("pixel_assets", sa.Column("archived_at", sa.String(), nullable=True))
    op.create_index("ix_pixel_assets_archived_at", "pixel_assets", ["archived_at"])


def downgrade():
    op.drop_index("ix_pixel_assets_archived_at", table_name="pixel_assets")
    op.drop_column("pixel_assets", "archived_at")
