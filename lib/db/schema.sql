CREATE TABLE users
(
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  handle VARCHAR(32) NOT NULL UNIQUE,
  world_id_session_id TEXT NOT NULL UNIQUE,
  world_id_session_commitment VARCHAR(66) NOT NULL UNIQUE,
  world_id_session_nullifier TEXT,
  world_id_credential_identifier VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE users ADD CONSTRAINT users_id_handle_key UNIQUE (id, handle);

-- Enable the uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Exactly one author identity per World ID session login.
CREATE TABLE authors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    handle VARCHAR(32) NOT NULL UNIQUE,
    bio TEXT,
    avatar TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT authors_login_handle_fk FOREIGN KEY ("userId", handle)
      REFERENCES users(id, handle) ON DELETE CASCADE
);

-- Create index on handle (though technically redundant due to UNIQUE constraint)
CREATE INDEX idx_authors_handle ON authors(handle);
CREATE INDEX idx_authors_user ON authors("userId");

CREATE TABLE publications (
    id BIGSERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "authorId" UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    content JSONB NOT NULL,
    proof JSONB NOT NULL,
    signal JSONB NOT NULL,
    title VARCHAR(255) NOT NULL,
    subtitle VARCHAR(255),
    date TIMESTAMPTZ NOT NULL,
    version VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_publications_world_id_signal_hash
    ON publications ((LOWER(proof->>'signal_hash')));

CREATE INDEX idx_publications_agent_document_signal_hash
    ON publications ((LOWER(proof->'agent_document_signature'->>'document_signal_hash')));

CREATE TABLE drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "authorId" UUID REFERENCES authors(id) ON DELETE SET NULL,
    status VARCHAR(255) NOT NULL,
    publication_type VARCHAR(16) NOT NULL DEFAULT 'article' CHECK (publication_type IN ('short', 'article')),
    title VARCHAR(255) NOT NULL,
    subtitle VARCHAR(255),
    content JSONB NOT NULL,
    history JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX idx_libro_publish_registrations_draft_user
    ON libro_publish_registrations("draftId", "userId");

CREATE UNIQUE INDEX idx_libro_publish_registrations_one_finalized_draft
    ON libro_publish_registrations("draftId")
    WHERE finalized_at IS NOT NULL;

CREATE TABLE libro_extension_auth_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE,
    intent VARCHAR(16) NOT NULL DEFAULT 'login',
    requested_handle VARCHAR(32) NOT NULL,
    request_ip_hash CHAR(64),
    verification_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (verification_attempts >= 0 AND verification_attempts <= 5),
    nonce VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (intent = 'login' AND "userId" IS NOT NULL)
        OR (intent = 'signup' AND "userId" IS NULL)
    )
);

CREATE INDEX idx_libro_extension_auth_attempts_user
    ON libro_extension_auth_attempts("userId", expires_at);

CREATE INDEX idx_libro_extension_auth_attempts_handle_created
    ON libro_extension_auth_attempts(requested_handle, created_at);

CREATE INDEX idx_libro_extension_auth_attempts_ip_created
    ON libro_extension_auth_attempts(request_ip_hash, created_at)
    WHERE request_ip_hash IS NOT NULL;

CREATE TABLE libro_extension_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_libro_extension_sessions_user
    ON libro_extension_sessions("userId", expires_at);

CREATE INDEX idx_libro_extension_sessions_expiry
    ON libro_extension_sessions(expires_at, revoked_at);

CREATE INDEX idx_extension_drafts_cleanup
    ON drafts(created_at)
    WHERE status = 'editing' AND history->>'source' = 'chrome_extension';

CREATE INDEX idx_extension_drafts_user_created
    ON drafts("userId", created_at)
    WHERE history->>'source' = 'chrome_extension';

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

-- Create function to update modified_at timestamp
CREATE OR REPLACE FUNCTION update_modified_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.modified_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updating modified_at
CREATE TRIGGER update_users_modified_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_at_column();

CREATE TRIGGER update_authors_modified_at
    BEFORE UPDATE ON authors
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_at_column();

CREATE TRIGGER update_publications_modified_at
    BEFORE UPDATE ON publications
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_at_column();

CREATE TRIGGER update_drafts_modified_at
    BEFORE UPDATE ON drafts
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_at_column();

CREATE OR REPLACE FUNCTION validate_draft_user_matches_author()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."authorId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM authors
        WHERE id = NEW."authorId" AND "userId" = NEW."userId"
    ) THEN
        RAISE EXCEPTION 'Draft user must match author user'
            USING ERRCODE = '23514', CONSTRAINT = 'draft_user_matches_author';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_draft_user_matches_author
    BEFORE INSERT OR UPDATE OF "userId", "authorId" ON drafts
    FOR EACH ROW
    EXECUTE FUNCTION validate_draft_user_matches_author();

-- Create function to validate user matches author
CREATE OR REPLACE FUNCTION validate_publication_user_matches_author()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."userId" != (SELECT "userId" FROM authors WHERE id = NEW."authorId") THEN
        RAISE EXCEPTION 'Publication user must match author user';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce user matches author
CREATE TRIGGER enforce_publication_user_matches_author
    BEFORE INSERT OR UPDATE ON publications
    FOR EACH ROW
    EXECUTE FUNCTION validate_publication_user_matches_author();
