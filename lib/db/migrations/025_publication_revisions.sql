ALTER TABLE publications ADD COLUMN root_publication_id BIGINT REFERENCES publications(id),
  ADD COLUMN previous_publication_id BIGINT REFERENCES publications(id),
  ADD COLUMN initially_published_at TIMESTAMPTZ,
  ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0);
UPDATE publications SET root_publication_id = id, initially_published_at = COALESCE((signal->>'publication_date')::timestamptz, date);
ALTER TABLE publications ALTER COLUMN initially_published_at SET DEFAULT CURRENT_TIMESTAMP, ALTER COLUMN initially_published_at SET NOT NULL;
CREATE UNIQUE INDEX publications_successor ON publications(previous_publication_id) WHERE previous_publication_id IS NOT NULL;
CREATE INDEX publications_family ON publications(root_publication_id, revision_number DESC);
ALTER TABLE publication_policies ADD COLUMN root_publication_id BIGINT,
  ADD COLUMN previous_publication_id BIGINT, ADD COLUMN initially_published_at TIMESTAMPTZ,
  ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0);
UPDATE publication_policies SET root_publication_id = publication_id;
CREATE INDEX publication_policies_family ON publication_policies(root_publication_id, revision_number DESC);
ALTER TABLE drafts ADD COLUMN previous_publication_id BIGINT;
ALTER TABLE pending_libro_publications ADD COLUMN previous_publication_id BIGINT;
ALTER TABLE world_id_publish_challenges ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'libro-v1', ADD COLUMN registry_address VARCHAR(42);
CREATE INDEX publication_access_grants_family_lookup ON publication_access_grants("publicationId", token_hash) WHERE settled_at IS NOT NULL;
CREATE TABLE libro_handle_claim_requests (
  id UUID PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handle VARCHAR(32) NOT NULL, registry_address VARCHAR(42) NOT NULL, signal_hash VARCHAR(66) NOT NULL,
  nonce VARCHAR(66), expires_at TIMESTAMPTZ, transaction JSONB, transaction_hash VARCHAR(66),
  finalized_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE libro_handle_claims ADD COLUMN registry_address VARCHAR(42);
ALTER TABLE libro_handle_claims DROP CONSTRAINT "libro_handle_claims_userId_key",
  DROP CONSTRAINT libro_handle_claims_handle_key, DROP CONSTRAINT libro_handle_claims_handle_hash_key,
  DROP CONSTRAINT libro_handle_claims_session_commitment_key;
CREATE UNIQUE INDEX libro_handle_claims_registry_user ON libro_handle_claims("userId",registry_address) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX libro_handle_claims_registry_hash ON libro_handle_claims(handle_hash,registry_address) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX libro_handle_claims_registry_session ON libro_handle_claims(session_commitment,registry_address) NULLS NOT DISTINCT;
