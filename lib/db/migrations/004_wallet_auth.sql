-- Switch active Memorioso login identity to World App wallet auth.
-- Existing World ID login rows are preserved, but users must sign in again with a wallet.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(42);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address
    ON users(wallet_address);
