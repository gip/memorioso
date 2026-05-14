-- Upgrade an existing Memorioso database for World ID 4.0.
-- This migration only adds new nullable structures and does not rewrite legacy rows.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS world_id_session_id TEXT,
  ADD COLUMN IF NOT EXISTS world_id_session_nullifier TEXT,
  ADD COLUMN IF NOT EXISTS world_id_credential_identifier VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_world_id_session_id
    ON users(world_id_session_id)
    WHERE world_id_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS world_id_publish_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "draftId" UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    action VARCHAR(255) NOT NULL,
    nonce VARCHAR(255) NOT NULL UNIQUE,
    signal_text TEXT NOT NULL,
    signal_hash VARCHAR(255) NOT NULL,
    publication JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_world_id_publish_challenges_draft_user
    ON world_id_publish_challenges("draftId", "userId");
