-- Allow short-lived extension auth attempts to onboard a first-time author.

ALTER TABLE libro_extension_auth_attempts
    ALTER COLUMN "userId" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS intent VARCHAR(16) NOT NULL DEFAULT 'login';

ALTER TABLE libro_extension_auth_attempts
    ADD CONSTRAINT libro_extension_auth_attempts_intent_check
    CHECK (
        (intent = 'login' AND "userId" IS NOT NULL)
        OR (intent = 'signup' AND "userId" IS NULL)
    );
