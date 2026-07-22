-- Add scoped Chrome extension sessions and resumable publication finalization.

ALTER TABLE libro_publish_registrations
    ADD COLUMN IF NOT EXISTS "publicationId" BIGINT REFERENCES publications(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS libro_extension_auth_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nonce VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_libro_extension_auth_attempts_user
    ON libro_extension_auth_attempts("userId", expires_at);

CREATE TABLE IF NOT EXISTS libro_extension_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_libro_extension_sessions_user
    ON libro_extension_sessions("userId", expires_at);
