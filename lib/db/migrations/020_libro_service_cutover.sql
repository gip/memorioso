ALTER TABLE users
  ADD COLUMN IF NOT EXISTS libro_identity_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_libro_identity
  ON users(libro_identity_id)
  WHERE libro_identity_id IS NOT NULL;

ALTER TABLE authors
  ADD COLUMN IF NOT EXISTS libro_service_managed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS publication_policies (
  publication_id BIGINT PRIMARY KEY,
  signal_hash VARCHAR(78) NOT NULL UNIQUE,
  "authorId" UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  origin_client_id TEXT,
  access VARCHAR(16) NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'gated')),
  access_price_usd NUMERIC(10, 6) CHECK (access_price_usd IS NULL OR access_price_usd > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO publication_policies
  (publication_id, signal_hash, "authorId", access, access_price_usd, created_at, modified_at)
SELECT p.id,
  LOWER(COALESCE(
    p.proof->>'signal_hash',
    p.proof->'agent_document_signature'->>'document_signal_hash'
  )),
  p."authorId", p.access, p.access_price_usd, p.created_at, p.modified_at
FROM publications p
WHERE COALESCE(
  p.proof->>'signal_hash',
  p.proof->'agent_document_signature'->>'document_signal_hash'
) IS NOT NULL
ON CONFLICT (publication_id) DO UPDATE SET
  signal_hash = EXCLUDED.signal_hash,
  "authorId" = EXCLUDED."authorId",
  access = EXCLUDED.access,
  access_price_usd = EXCLUDED.access_price_usd,
  modified_at = EXCLUDED.modified_at;

ALTER TABLE publication_access_grants
  DROP CONSTRAINT IF EXISTS "publication_access_grants_publicationId_fkey";

ALTER TABLE publication_access_grants
  ADD CONSTRAINT publication_access_grants_policy_fk
  FOREIGN KEY ("publicationId") REFERENCES publication_policies(publication_id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS pending_libro_publications (
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

CREATE TABLE IF NOT EXISTS processed_libro_events (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS draft_publication_acknowledgements (
  "draftId" UUID PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
  publication_id BIGINT NOT NULL UNIQUE,
  signal_hash VARCHAR(78) NOT NULL UNIQUE,
  service_event_id UUID NOT NULL UNIQUE REFERENCES processed_libro_events(event_id) ON DELETE RESTRICT,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS libro_oauth_sessions (
  "userId" INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT[] NOT NULL,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_publication_policies_author
  ON publication_policies("authorId", publication_id DESC);

CREATE INDEX IF NOT EXISTS idx_pending_libro_publications_draft
  ON pending_libro_publications("draftId", created_at DESC);
