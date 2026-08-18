-- Gated publications: access is stored outside the signed payload.
-- publications.signal is immutable and its hash is registered on chain, so the
-- access flag lives in its own columns and never touches the signal JSONB.

ALTER TABLE publications
    ADD COLUMN IF NOT EXISTS access VARCHAR(16) NOT NULL DEFAULT 'public',
    ADD COLUMN IF NOT EXISTS access_price_usd NUMERIC(10, 6);

ALTER TABLE publications
    DROP CONSTRAINT IF EXISTS publications_access_check;
ALTER TABLE publications
    ADD CONSTRAINT publications_access_check CHECK (access IN ('public', 'gated'));

ALTER TABLE publications
    DROP CONSTRAINT IF EXISTS publications_access_price_positive;
ALTER TABLE publications
    ADD CONSTRAINT publications_access_price_positive
    CHECK (access_price_usd IS NULL OR access_price_usd > 0);

ALTER TABLE drafts
    ADD COLUMN IF NOT EXISTS access VARCHAR(16) NOT NULL DEFAULT 'public';

ALTER TABLE drafts
    DROP CONSTRAINT IF EXISTS drafts_access_check;
ALTER TABLE drafts
    ADD CONSTRAINT drafts_access_check CHECK (access IN ('public', 'gated'));

-- One settled x402 payment unlocks one publication for one payer, forever.
-- A row is reserved before the transfer is broadcast (settled_at NULL) and completed
-- once the receipt confirms, so a crash between the two cannot take money without
-- granting access. The unique authorization_nonce doubles as the broadcast lock.
CREATE TABLE IF NOT EXISTS publication_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "publicationId" BIGINT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
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
-- LOWER() so a checksummed and a lowercase address cannot both hold a grant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_publication_access_grants_settled_payer
    ON publication_access_grants("publicationId", LOWER(payer_address))
    WHERE settled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publication_access_grants_publication
    ON publication_access_grants("publicationId");

CREATE INDEX IF NOT EXISTS idx_publication_access_grants_unsettled
    ON publication_access_grants(valid_before)
    WHERE settled_at IS NULL;
