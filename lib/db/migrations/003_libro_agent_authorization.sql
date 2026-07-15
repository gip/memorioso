CREATE TABLE IF NOT EXISTS libro_agent_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "authorId" UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    registration_hash VARCHAR(66) NOT NULL UNIQUE,
    principal_author_hash VARCHAR(66) NOT NULL,
    controller_address VARCHAR(42) NOT NULL,
    agent_address VARCHAR(42) NOT NULL,
    scope INTEGER NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    action VARCHAR(255) NOT NULL,
    nonce VARCHAR(255) NOT NULL UNIQUE,
    signal VARCHAR(255) NOT NULL,
    signal_hash VARCHAR(78) NOT NULL,
    payload JSONB NOT NULL,
    proof JSONB,
    chain_id INTEGER NOT NULL,
    registry_address VARCHAR(255) NOT NULL,
    transaction JSONB,
    user_op_hash VARCHAR(255),
    transaction_hash VARCHAR(255),
    finalized_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_libro_agent_registrations_author_user
    ON libro_agent_registrations("authorId", "userId");

CREATE TABLE IF NOT EXISTS libro_agent_document_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "registrationId" UUID NOT NULL REFERENCES libro_agent_registrations(id) ON DELETE CASCADE,
    "publicationId" BIGINT REFERENCES publications(id) ON DELETE SET NULL,
    registration_hash VARCHAR(66) NOT NULL,
    document_signal_hash VARCHAR(78) NOT NULL UNIQUE,
    document_signal_text TEXT NOT NULL,
    document_nonce VARCHAR(66) NOT NULL,
    signed_at TIMESTAMPTZ NOT NULL,
    agent_address VARCHAR(42) NOT NULL,
    agent_signature TEXT NOT NULL,
    publication JSONB NOT NULL,
    proof JSONB NOT NULL,
    chain_id INTEGER NOT NULL,
    registry_address VARCHAR(255) NOT NULL,
    transaction JSONB NOT NULL,
    user_op_hash VARCHAR(255),
    transaction_hash VARCHAR(255),
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_libro_agent_document_registrations_registration
    ON libro_agent_document_registrations("registrationId");
