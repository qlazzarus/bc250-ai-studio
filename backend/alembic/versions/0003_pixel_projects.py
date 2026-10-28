"""Add pixel project, asset, and version records."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "pixel_projects",
        sa.Column("project_id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("art_bible", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
    op.create_table(
        "pixel_assets",
        sa.Column("asset_id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("source_asset_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("approved_version_id", sa.String()),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
    op.create_index("ix_pixel_assets_project_id", "pixel_assets", ["project_id"])
    op.create_table(
        "pixel_versions",
        sa.Column("version_id", sa.String(), primary_key=True),
        sa.Column("asset_id", sa.String(), nullable=False),
        sa.Column("relative_path", sa.String(), nullable=False, unique=True),
        sa.Column("operation", sa.String(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_pixel_versions_asset_id", "pixel_versions", ["asset_id"])


def downgrade():
    op.drop_table("pixel_versions")
    op.drop_table("pixel_assets")
    op.drop_table("pixel_projects")
