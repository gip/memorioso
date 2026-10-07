ALTER TABLE libro_publications ADD COLUMN root_publication_id BIGINT REFERENCES libro_publications(id),
  ADD COLUMN previous_publication_id BIGINT REFERENCES libro_publications(id),
  ADD COLUMN initially_published_at TIMESTAMPTZ,
  ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0);
UPDATE libro_publications SET root_publication_id = id, initially_published_at = COALESCE((signal->>'publication_date')::timestamptz, date);
ALTER TABLE libro_publications ALTER COLUMN initially_published_at SET DEFAULT CURRENT_TIMESTAMP, ALTER COLUMN initially_published_at SET NOT NULL;
CREATE UNIQUE INDEX libro_publications_successor ON libro_publications(previous_publication_id) WHERE previous_publication_id IS NOT NULL;
CREATE INDEX libro_publications_family ON libro_publications(root_publication_id, revision_number DESC);
ALTER TABLE libro_publish_challenges ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'libro-v1', ADD COLUMN registry_address VARCHAR(42);
UPDATE libro_publish_challenges c SET registry_address = r.registry_address FROM libro_human_registrations r WHERE r.challenge_id = c.id;
ALTER TABLE libro_handle_claim_requests ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'libro-v1', ADD COLUMN registry_address VARCHAR(42);
ALTER TABLE libro_handle_claims DROP CONSTRAINT libro_handle_claims_pkey;
ALTER TABLE libro_handle_claims DROP CONSTRAINT libro_handle_claims_handle_key;
ALTER TABLE libro_handle_claims DROP CONSTRAINT libro_handle_claims_handle_hash_key;
ALTER TABLE libro_handle_claims DROP CONSTRAINT libro_handle_claims_session_commitment_key;
ALTER TABLE libro_handle_claims ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ADD COLUMN registry_address VARCHAR(42);
CREATE UNIQUE INDEX libro_handle_claims_registry_identity ON libro_handle_claims(identity_id, registry_address) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX libro_handle_claims_registry_handle ON libro_handle_claims(handle_hash, registry_address) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX libro_handle_claims_registry_session ON libro_handle_claims(session_commitment,registry_address) NULLS NOT DISTINCT;
