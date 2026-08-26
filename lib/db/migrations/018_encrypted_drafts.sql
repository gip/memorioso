-- Client-side encrypted drafts.
--
-- Draft prose is private by design, so it stops being stored in the clear. The
-- browser encrypts {title, subtitle, content} under a per-author data key and
-- writes the envelope to drafts.ciphertext; the server never holds the key.
--
-- title and content lose their NOT NULL so that "no plaintext left" is a
-- question SQL can answer. They stay in place until every row has migrated.

ALTER TABLE drafts
    ADD COLUMN IF NOT EXISTS ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS encryption VARCHAR(8) NOT NULL DEFAULT 'none';

ALTER TABLE drafts ALTER COLUMN title DROP NOT NULL;
ALTER TABLE drafts ALTER COLUMN content DROP NOT NULL;

ALTER TABLE drafts
    DROP CONSTRAINT IF EXISTS drafts_encryption_check;
ALTER TABLE drafts
    ADD CONSTRAINT drafts_encryption_check CHECK (encryption IN ('none', 'v1'));

-- An encrypted draft must carry its envelope, and must not also carry prose.
-- Enforcing both halves here is what stops a half-finished write from leaving
-- readable text behind next to the ciphertext that replaced it.
ALTER TABLE drafts
    DROP CONSTRAINT IF EXISTS drafts_encryption_shape_check;
ALTER TABLE drafts
    ADD CONSTRAINT drafts_encryption_shape_check CHECK (
        (encryption = 'none' AND ciphertext IS NULL AND title IS NOT NULL AND content IS NOT NULL)
        OR
        (encryption = 'v1' AND ciphertext IS NOT NULL AND title IS NULL AND subtitle IS NULL AND content IS NULL)
    );

-- The author's data key, wrapped once per secret that may open it.
--
-- Both wrappers hold the same data key, so either opens every draft: 'worldid'
-- derives its key from login proof material and needs nothing remembered, while
-- 'recovery' derives from a code shown once and is what survives a lost World ID
-- identity. Only wrapped bytes live here; the data key itself never reaches the
-- server in any form.
CREATE TABLE IF NOT EXISTS user_draft_key_wrappers (
    "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapper         VARCHAR(16) NOT NULL,
    kdf_salt        BYTEA NOT NULL,
    -- A public identifier for the unwrapping key, so the client can tell a wrong
    -- key from damaged bytes instead of reading an opaque AES-GCM failure.
    kek_fingerprint CHAR(64) NOT NULL,
    wrapped_dek     BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", wrapper),
    CONSTRAINT user_draft_key_wrappers_wrapper_check CHECK (wrapper IN ('worldid', 'recovery'))
);

CREATE TRIGGER update_user_draft_key_wrappers_modified_at
    BEFORE UPDATE ON user_draft_key_wrappers
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_at_column();
