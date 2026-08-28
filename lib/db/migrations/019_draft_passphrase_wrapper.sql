-- The draft key stops depending on World ID proof material.
--
-- The 'worldid' wrapper derived its key from responses[0].session_nullifier[1]
-- of a session login, on the assumption that the value reproduced across logins.
-- It does not: LibroRegistry marks session_nullifier[0] used on every
-- registration, so the pair is per-proof replay protection, not a per-author
-- identifier. Authors were being asked for their recovery code on every new
-- sign-in, which is the fallback path, not a way to work.
--
-- A passphrase replaces it. Because the data key is wrapped rather than derived,
-- swapping the wrapper costs nothing: not one draft is re-encrypted.

-- Whether this author wants their drafts encrypted. NULL means they have not
-- been asked yet; 'none' means they were asked and declined, which is a real
-- answer and must not be confused with the first one.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS draft_encryption VARCHAR(16);

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_draft_encryption_check;
ALTER TABLE users
    ADD CONSTRAINT users_draft_encryption_check CHECK (
        draft_encryption IS NULL OR draft_encryption IN ('passphrase', 'none')
    );

-- A passphrase carries far less entropy than the key it wraps, so it is
-- stretched with PBKDF2 rather than HKDF. The cost is stored per row: a cost
-- that cannot be read back can never be raised, because a wrapper written under
-- the old count would stop deriving and be indistinguishable from a typo.
ALTER TABLE user_draft_key_wrappers
    ADD COLUMN IF NOT EXISTS kdf_iterations INTEGER;

-- Nothing opens these any more, and leaving them would let a client keep
-- offering a key source that cannot work.
DELETE FROM user_draft_key_wrappers WHERE wrapper = 'worldid';

ALTER TABLE user_draft_key_wrappers
    DROP CONSTRAINT IF EXISTS user_draft_key_wrappers_wrapper_check;
ALTER TABLE user_draft_key_wrappers
    ADD CONSTRAINT user_draft_key_wrappers_wrapper_check CHECK (wrapper IN ('passphrase', 'recovery'));

ALTER TABLE user_draft_key_wrappers
    DROP CONSTRAINT IF EXISTS user_draft_key_wrappers_kdf_iterations_check;
ALTER TABLE user_draft_key_wrappers
    ADD CONSTRAINT user_draft_key_wrappers_kdf_iterations_check CHECK (
        (wrapper = 'passphrase' AND kdf_iterations IS NOT NULL AND kdf_iterations >= 100000)
        OR
        (wrapper <> 'passphrase' AND kdf_iterations IS NULL)
    );

-- An author who already has a key keeps it. The recovery wrapper's derivation is
-- unchanged, so their code still opens the same data key; they are asked for it
-- once and can set a passphrase from there.
UPDATE users
   SET draft_encryption = 'passphrase'
 WHERE id IN (SELECT "userId" FROM user_draft_key_wrappers);
