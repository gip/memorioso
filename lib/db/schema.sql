CREATE TABLE users
(
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  handle VARCHAR(32) UNIQUE,
  world_id_session_id TEXT UNIQUE,
  world_id_session_commitment VARCHAR(66) UNIQUE,
  world_id_session_nullifier TEXT,
  world_id_credential_identifier VARCHAR(255),
  libro_identity_status VARCHAR(16) NOT NULL DEFAULT 'session_bound',
  libro_identity_id UUID UNIQUE,
  -- Whether this author wants their drafts encrypted. NULL means not yet asked;
  -- 'none' means asked and declined, which is a different thing.
  draft_encryption VARCHAR(16) CHECK (draft_encryption IS NULL OR draft_encryption IN ('passphrase', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_session_bound_identity_complete CHECK (
    libro_identity_status = 'legacy'
    OR (
      handle IS NOT NULL
      AND world_id_session_id ~ '^session_[0-9a-fA-F]{128}$'
      AND world_id_session_commitment IS NOT NULL
    )
  )
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
    libro_service_managed BOOLEAN NOT NULL DEFAULT FALSE,
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
    access VARCHAR(16) NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'gated')),
    access_price_usd NUMERIC(10, 6) CHECK (access_price_usd IS NULL OR access_price_usd > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_publications_world_id_signal_hash
    ON publications ((LOWER(proof->>'signal_hash')));

CREATE INDEX idx_publications_agent_document_signal_hash
    ON publications ((LOWER(proof->'agent_document_signature'->>'document_signal_hash')));

-- Feeds sort newest-first on `date`, which both publish paths fill from the signed
-- payload's publication_date. Sorting on the JSONB value instead cannot be indexed:
-- text-to-timestamp casting is STABLE, not IMMUTABLE.
CREATE INDEX idx_publications_date
    ON publications(date DESC);

CREATE INDEX idx_publications_author_date
    ON publications("authorId", date DESC);

CREATE INDEX idx_publications_user_date
    ON publications("userId", date DESC);

-- Memorioso presentation policy remains local after Libro becomes authoritative for
-- canonical publication data. There is intentionally no cross-database foreign key.
CREATE TABLE publication_policies (
    publication_id BIGINT PRIMARY KEY,
    signal_hash VARCHAR(78) NOT NULL UNIQUE,
    "authorId" UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    origin_client_id TEXT,
    access VARCHAR(16) NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'gated')),
    access_price_usd NUMERIC(10, 6) CHECK (access_price_usd IS NULL OR access_price_usd > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_publication_policies_author
    ON publication_policies("authorId", publication_id DESC);

-- One settled x402 payment unlocks one publication for one payer, forever.
-- A row is reserved before the transfer is broadcast (settled_at NULL) and completed
-- once the receipt confirms, so a crash between the two cannot take money without
-- granting access. The unique authorization_nonce doubles as the broadcast lock.
CREATE TABLE publication_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "publicationId" BIGINT NOT NULL REFERENCES publication_policies(publication_id) ON DELETE CASCADE,
    payer_address VARCHAR(42) NOT NULL,
    scheme VARCHAR(16) NOT NULL,
    network VARCHAR(32) NOT NULL,
    asset_address VARCHAR(42) NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    valid_before TIMESTAMPTZ NOT NULL,
    authorization_nonce VARCHAR(66) NOT NULL UNIQUE,
    transaction_hash VARCHAR(66),
    token_hash CHAR(64) NOT NULL UNIQUE,
    settled_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Partial, so a failed attempt never permanently bars a payer from retrying.
CREATE UNIQUE INDEX idx_publication_access_grants_settled_payer
    ON publication_access_grants("publicationId", LOWER(payer_address))
    WHERE settled_at IS NOT NULL;

CREATE INDEX idx_publication_access_grants_publication
    ON publication_access_grants("publicationId");

CREATE INDEX idx_publication_access_grants_unsettled
    ON publication_access_grants(valid_before)
    WHERE settled_at IS NULL;

-- Draft prose is encrypted in the browser: an 'v1' draft carries only
-- drafts.ciphertext, and title/subtitle/content stay null. The plaintext columns
-- remain for rows written before encryption and for the extension's transient
-- inline-signing drafts, which the server writes itself and publishes at once.
CREATE TABLE drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "authorId" UUID REFERENCES authors(id) ON DELETE SET NULL,
    status VARCHAR(255) NOT NULL,
    publication_type VARCHAR(16) NOT NULL DEFAULT 'article' CHECK (publication_type IN ('short', 'article')),
    title VARCHAR(255),
    subtitle VARCHAR(255),
    content JSONB,
    ciphertext TEXT,
    encryption VARCHAR(8) NOT NULL DEFAULT 'none' CHECK (encryption IN ('none', 'v1')),
    history JSONB NOT NULL,
    access VARCHAR(16) NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'gated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Enforcing both halves is what stops a half-finished write from leaving
    -- readable text beside the ciphertext that replaced it.
    CONSTRAINT drafts_encryption_shape_check CHECK (
        (encryption = 'none' AND ciphertext IS NULL AND title IS NOT NULL AND content IS NOT NULL)
        OR
        (encryption = 'v1' AND ciphertext IS NOT NULL AND title IS NULL AND subtitle IS NULL AND content IS NULL)
    )
);

CREATE TABLE pending_libro_publications (
    service_challenge_id UUID PRIMARY KEY,
    client_reference TEXT NOT NULL UNIQUE,
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "authorId" UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    "draftId" UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    signal_hash VARCHAR(78) NOT NULL,
    access VARCHAR(16) NOT NULL CHECK (access IN ('public', 'gated')),
    access_price_usd NUMERIC(10, 6) CHECK (access_price_usd IS NULL OR access_price_usd > 0),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("draftId", signal_hash)
);
CREATE INDEX idx_pending_libro_publications_draft
    ON pending_libro_publications("draftId", created_at DESC);

CREATE TABLE processed_libro_events (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE draft_publication_acknowledgements (
    "draftId" UUID PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
    publication_id BIGINT NOT NULL UNIQUE,
    signal_hash VARCHAR(78) NOT NULL UNIQUE,
    service_event_id UUID NOT NULL UNIQUE REFERENCES processed_libro_events(event_id) ON DELETE RESTRICT,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE libro_oauth_sessions (
    "userId" INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token_ciphertext TEXT NOT NULL,
    refresh_token_ciphertext TEXT NOT NULL,
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_expires_at TIMESTAMPTZ NOT NULL,
    scope TEXT[] NOT NULL,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The author's data key, wrapped once per secret that may open it.
--
-- Both wrappers hold the same data key, so either opens every draft: 'worldid'
-- derives its key from login proof material and needs nothing remembered, while
-- 'recovery' derives from a code shown once and is what survives a lost World ID
-- identity. Only wrapped bytes live here; the data key never reaches the server.
CREATE TABLE user_draft_key_wrappers (
    "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapper         VARCHAR(16) NOT NULL CHECK (wrapper IN ('passphrase', 'recovery')),
    kdf_salt        BYTEA NOT NULL,
    -- PBKDF2 cost for a passphrase, which needs stretching; NULL for a recovery
    -- code, which is 128 random bits and does not. Stored rather than pinned in
    -- code so the cost can be raised without stranding older wrappers.
    kdf_iterations  INTEGER,
    -- A public identifier for the unwrapping key, so the client can tell a wrong
    -- key from damaged bytes instead of reading an opaque AES-GCM failure.
    kek_fingerprint CHAR(64) NOT NULL,
    wrapped_dek     BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", wrapper),
    CONSTRAINT user_draft_key_wrappers_kdf_iterations_check CHECK (
        (wrapper = 'passphrase' AND kdf_iterations IS NOT NULL AND kdf_iterations >= 100000)
        OR
        (wrapper <> 'passphrase' AND kdf_iterations IS NULL)
    )
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
    transaction_hash VARCHAR(66) NOT NULL UNIQUE,
    finalized_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TRIGGER update_user_draft_key_wrappers_modified_at
    BEFORE UPDATE ON user_draft_key_wrappers
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

-- Proposed changes submitted through the OpenShip Changes endpoint.
--
-- The patch is stored as submitted rather than as a resulting tree: the base digest plus the patch
-- is what the author signed up to, and re-deriving the tree at build time is how the worker's
-- re-validation stays honest.

CREATE TABLE IF NOT EXISTS openship_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    build_id TEXT NOT NULL,
    base_digest TEXT NOT NULL,
    result_digest TEXT NOT NULL,
    title TEXT NOT NULL,
    intent TEXT NOT NULL,
    patch JSONB NOT NULL,
    files_changed INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    reason TEXT,
    -- Reserved candidate origin. Stored at acceptance; the status says when it is live.
    url TEXT,
    submitter TEXT,
    -- Set by the worker when it claims the row, so a crashed build can be reclaimed by age.
    claimed_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT openship_changes_status_check
        CHECK (status IN ('queued', 'building', 'reviewing', 'deployed', 'rejected', 'failed'))
);

-- The buildId is the digest of the resulting tree, so an identical resubmission is the same build.
-- Deduplicating here means a resubmission returns the existing record instead of paying twice.
CREATE UNIQUE INDEX IF NOT EXISTS openship_changes_result_digest_key
    ON openship_changes (result_digest);

CREATE INDEX IF NOT EXISTS openship_changes_queue_idx
    ON openship_changes (status, submitted_at)
    WHERE status IN ('queued', 'building', 'reviewing');

CREATE TRIGGER update_openship_changes_modified_at
    BEFORE UPDATE ON openship_changes
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_at_column();

-- Keep the legacy writer compatible throughout the shadow-copy period.
CREATE OR REPLACE FUNCTION sync_legacy_publication_policy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO publication_policies
    (publication_id, signal_hash, "authorId", access, access_price_usd, created_at, modified_at)
  VALUES (NEW.id, LOWER(COALESCE(NEW.proof->>'signal_hash',
    NEW.proof->'agent_document_signature'->>'document_signal_hash')),
    NEW."authorId", NEW.access, NEW.access_price_usd, NEW.created_at, NEW.modified_at)
  ON CONFLICT (publication_id) DO UPDATE SET
    signal_hash = EXCLUDED.signal_hash, "authorId" = EXCLUDED."authorId",
    access = EXCLUDED.access, access_price_usd = EXCLUDED.access_price_usd,
    modified_at = EXCLUDED.modified_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_legacy_publication_policy ON publications;
CREATE TRIGGER sync_legacy_publication_policy AFTER INSERT OR UPDATE ON publications
FOR EACH ROW EXECUTE FUNCTION sync_legacy_publication_policy();

CREATE TABLE libro_extension_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_hash CHAR(64) NOT NULL UNIQUE,
  "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '10 minutes',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
