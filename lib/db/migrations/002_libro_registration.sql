-- Add pending on-chain Libro publication registration records.
-- Proof material is persisted after server-side challenge validation so finalize only needs transaction identifiers.

CREATE TABLE IF NOT EXISTS libro_publish_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "draftId" UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    "challengeId" UUID NOT NULL REFERENCES world_id_publish_challenges(id) ON DELETE CASCADE UNIQUE,
    signal_hash VARCHAR(255) NOT NULL,
    contract_signal_hash VARCHAR(78) NOT NULL,
    chain_id INTEGER NOT NULL,
    registry_address VARCHAR(255) NOT NULL,
    proof JSONB NOT NULL,
    transaction JSONB NOT NULL,
    user_op_hash VARCHAR(255),
    transaction_hash VARCHAR(255),
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_libro_publish_registrations_draft_user
    ON libro_publish_registrations("draftId", "userId");
