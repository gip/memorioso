ALTER TABLE libro_publish_registrations
    DROP COLUMN IF EXISTS handle_permit;

ALTER TABLE libro_handle_claims
    DROP COLUMN IF EXISTS permit_nonce,
    DROP COLUMN IF EXISTS permit_deadline;

DROP TABLE IF EXISTS libro_handle_permits;
