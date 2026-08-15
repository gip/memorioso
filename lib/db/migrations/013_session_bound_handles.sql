-- HARD CUTOVER. Back up Postgres before applying this migration.
-- Old Libro proof registrations are intentionally unsupported after this point.
-- Retain only the signup author whose handle is the login handle. Drafts and
-- publications belonging to secondary authors are destroyed as selected.
-- Some pre-session accounts never populated users.handle. Select their primary
-- author deterministically by preserved publication count, then draft count,
-- then age, so the most valuable legacy identity survives the hard cutover.
WITH ranked_authors AS (
    SELECT
        a."userId",
        a.handle,
        ROW_NUMBER() OVER (
            PARTITION BY a."userId"
            ORDER BY
                (SELECT COUNT(*) FROM publications p WHERE p."authorId" = a.id) DESC,
                (SELECT COUNT(*) FROM drafts d WHERE d."authorId" = a.id) DESC,
                a.created_at ASC,
                a.id ASC
        ) AS rank
    FROM authors a
    INNER JOIN users u ON u.id = a."userId"
    WHERE u.handle IS NULL
)
UPDATE users u
SET handle = ranked.handle
FROM ranked_authors ranked
WHERE ranked."userId" = u.id AND ranked.rank = 1;

DELETE FROM drafts d
USING authors a, users u
WHERE d."authorId" = a.id
  AND a."userId" = u.id
  AND a.handle <> u.handle;

DELETE FROM publications p
USING authors a, users u
WHERE p."authorId" = a.id
  AND a."userId" = u.id
  AND a.handle <> u.handle;

DELETE FROM libro_agent_registrations r
USING authors a, users u
WHERE r."authorId" = a.id
  AND a."userId" = u.id
  AND a.handle <> u.handle;

DELETE FROM authors a
USING users u
WHERE a."userId" = u.id
  AND a.handle <> u.handle;

ALTER TABLE users ADD COLUMN libro_identity_status VARCHAR(16) NOT NULL DEFAULT 'legacy';
ALTER TABLE users ADD CONSTRAINT users_id_handle_key UNIQUE (id, handle);

DROP TRIGGER IF EXISTS enforce_authors_per_user_limit ON authors;
DROP FUNCTION IF EXISTS enforce_author_limit();
ALTER TABLE authors ADD CONSTRAINT authors_one_per_user UNIQUE ("userId");
ALTER TABLE authors ADD CONSTRAINT authors_login_handle_fk
    FOREIGN KEY ("userId", handle) REFERENCES users(id, handle) ON DELETE CASCADE;

ALTER TABLE users ADD COLUMN world_id_session_commitment VARCHAR(66);
UPDATE users
SET world_id_session_commitment = '0x' || substring(world_id_session_id FROM 9 FOR 64)
WHERE world_id_session_id ~ '^session_[0-9a-fA-F]{128}$';
ALTER TABLE users ADD CONSTRAINT users_world_id_session_commitment_key UNIQUE (world_id_session_commitment);
UPDATE users
SET libro_identity_status = 'session_bound'
WHERE handle IS NOT NULL
  AND world_id_session_id ~ '^session_[0-9a-fA-F]{128}$'
  AND world_id_session_commitment IS NOT NULL;
ALTER TABLE users ALTER COLUMN libro_identity_status SET DEFAULT 'session_bound';
ALTER TABLE users ADD CONSTRAINT users_session_bound_identity_complete CHECK (
    libro_identity_status = 'legacy'
    OR (
        handle IS NOT NULL
        AND world_id_session_id ~ '^session_[0-9a-fA-F]{128}$'
        AND world_id_session_commitment IS NOT NULL
    )
);

DROP TABLE IF EXISTS libro_agent_document_registrations CASCADE;
DROP TABLE IF EXISTS libro_agent_registrations CASCADE;
DROP TABLE IF EXISTS libro_publish_registrations CASCADE;
DROP TABLE IF EXISTS world_id_publish_challenges CASCADE;

CREATE TABLE world_id_publish_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "draftId" UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    nonce VARCHAR(255) NOT NULL UNIQUE,
    session_commitment VARCHAR(66) NOT NULL,
    signal_text TEXT NOT NULL,
    signal_hash VARCHAR(66) NOT NULL,
    publication JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_world_id_publish_challenges_draft_user
    ON world_id_publish_challenges("draftId", "userId");

CREATE TABLE world_id_signup_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_handle VARCHAR(32) NOT NULL,
    request_ip_hash CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_world_id_signup_attempts_handle_created
    ON world_id_signup_attempts(requested_handle, created_at);
CREATE INDEX idx_world_id_signup_attempts_ip_created
    ON world_id_signup_attempts(request_ip_hash, created_at) WHERE request_ip_hash IS NOT NULL;

CREATE TABLE libro_handle_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    handle VARCHAR(32) NOT NULL UNIQUE,
    handle_hash VARCHAR(66) NOT NULL UNIQUE,
    session_commitment VARCHAR(66) NOT NULL UNIQUE,
    permit_nonce VARCHAR(66) NOT NULL UNIQUE,
    permit_deadline TIMESTAMPTZ NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL UNIQUE,
    finalized_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE libro_handle_permits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    handle_hash VARCHAR(66) NOT NULL,
    session_commitment VARCHAR(66) NOT NULL,
    permit_nonce VARCHAR(66) NOT NULL UNIQUE,
    permit_deadline TIMESTAMPTZ NOT NULL,
    purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('human', 'agent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_libro_handle_permits_user_created
    ON libro_handle_permits("userId", created_at);

CREATE TABLE libro_publish_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "draftId" UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    "challengeId" UUID NOT NULL REFERENCES world_id_publish_challenges(id) ON DELETE CASCADE UNIQUE,
    signal_hash VARCHAR(66) NOT NULL,
    contract_signal_hash VARCHAR(78) NOT NULL,
    handle_hash VARCHAR(66) NOT NULL,
    session_commitment VARCHAR(66) NOT NULL,
    session_nullifier VARCHAR(78) NOT NULL,
    handle_permit JSONB,
    chain_id INTEGER NOT NULL,
    registry_address VARCHAR(42) NOT NULL,
    proof JSONB NOT NULL,
    transaction JSONB NOT NULL,
    user_op_hash VARCHAR(66),
    transaction_hash VARCHAR(66),
    "publicationId" BIGINT REFERENCES publications(id) ON DELETE SET NULL,
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_libro_publish_registrations_draft_user
    ON libro_publish_registrations("draftId", "userId");
CREATE UNIQUE INDEX idx_libro_publish_registrations_one_finalized_draft
    ON libro_publish_registrations("draftId") WHERE finalized_at IS NOT NULL;

CREATE TABLE libro_agent_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "authorId" UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    registration_hash VARCHAR(66) NOT NULL UNIQUE,
    handle_hash VARCHAR(66) NOT NULL,
    session_commitment VARCHAR(66) NOT NULL,
    controller_address VARCHAR(42) NOT NULL,
    agent_address VARCHAR(42) NOT NULL,
    scope INTEGER NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    nonce VARCHAR(255) NOT NULL UNIQUE,
    signal TEXT NOT NULL,
    signal_hash VARCHAR(78) NOT NULL,
    payload JSONB NOT NULL,
    proof JSONB,
    chain_id INTEGER NOT NULL,
    registry_address VARCHAR(42) NOT NULL,
    transaction JSONB,
    user_op_hash VARCHAR(66),
    transaction_hash VARCHAR(66),
    finalized_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_libro_agent_registrations_author_user
    ON libro_agent_registrations("authorId", "userId");

CREATE TABLE libro_agent_document_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "registrationId" UUID NOT NULL REFERENCES libro_agent_registrations(id) ON DELETE CASCADE,
    "publicationId" BIGINT REFERENCES publications(id) ON DELETE SET NULL,
    registration_hash VARCHAR(66) NOT NULL,
    handle_hash VARCHAR(66) NOT NULL,
    document_signal_hash VARCHAR(78) NOT NULL UNIQUE,
    document_signal_text TEXT NOT NULL,
    document_nonce VARCHAR(66) NOT NULL,
    signed_at TIMESTAMPTZ NOT NULL,
    agent_address VARCHAR(42) NOT NULL,
    agent_signature TEXT NOT NULL,
    publication JSONB NOT NULL,
    proof JSONB NOT NULL,
    chain_id INTEGER NOT NULL,
    registry_address VARCHAR(42) NOT NULL,
    transaction JSONB NOT NULL,
    user_op_hash VARCHAR(66),
    transaction_hash VARCHAR(66),
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_libro_agent_document_registrations_registration
    ON libro_agent_document_registrations("registrationId");
