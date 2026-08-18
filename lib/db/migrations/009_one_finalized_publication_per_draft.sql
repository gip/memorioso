CREATE UNIQUE INDEX IF NOT EXISTS idx_libro_publish_registrations_one_finalized_draft
    ON libro_publish_registrations("draftId")
    WHERE finalized_at IS NOT NULL;
