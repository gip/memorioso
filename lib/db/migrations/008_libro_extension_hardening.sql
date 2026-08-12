-- Bind extension authentication attempts to their requested identity and add abuse controls.

ALTER TABLE libro_extension_auth_attempts
    ADD COLUMN IF NOT EXISTS requested_handle VARCHAR(32),
    ADD COLUMN IF NOT EXISTS request_ip_hash CHAR(64),
    ADD COLUMN IF NOT EXISTS verification_attempts SMALLINT NOT NULL DEFAULT 0;

UPDATE libro_extension_auth_attempts a
SET requested_handle = u.handle
FROM users u
WHERE a."userId" = u.id AND a.requested_handle IS NULL;

-- Pre-hardening signup attempts did not retain their requested handle and cannot be bound safely.
DELETE FROM libro_extension_auth_attempts WHERE requested_handle IS NULL;

ALTER TABLE libro_extension_auth_attempts
    ALTER COLUMN requested_handle SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'libro_extension_auth_attempts_verification_attempts_check'
    ) THEN
        ALTER TABLE libro_extension_auth_attempts
            ADD CONSTRAINT libro_extension_auth_attempts_verification_attempts_check
            CHECK (verification_attempts >= 0 AND verification_attempts <= 5);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_libro_extension_auth_attempts_handle_created
    ON libro_extension_auth_attempts(requested_handle, created_at);

CREATE INDEX IF NOT EXISTS idx_libro_extension_auth_attempts_ip_created
    ON libro_extension_auth_attempts(request_ip_hash, created_at)
    WHERE request_ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_libro_extension_sessions_expiry
    ON libro_extension_sessions(expires_at, revoked_at);

CREATE INDEX IF NOT EXISTS idx_extension_drafts_cleanup
    ON drafts(created_at)
    WHERE status = 'editing' AND history->>'source' = 'chrome_extension';

CREATE INDEX IF NOT EXISTS idx_extension_drafts_user_created
    ON drafts("userId", created_at)
    WHERE history->>'source' = 'chrome_extension';
