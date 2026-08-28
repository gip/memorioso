-- Proposed changes submitted through the OpenShip Changes endpoint.
--
-- The patch is stored as submitted rather than as a resulting tree: the base digest plus the patch
-- is what the author signed up to, and re-deriving the tree at build time is how the worker's
-- re-validation stays honest.

CREATE TABLE IF NOT EXISTS openship_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    build_id TEXT NOT NULL,
    base_digest TEXT NOT NULL,
    result_digest TEXT NOT NULL,
    title TEXT NOT NULL,
    intent TEXT NOT NULL,
    patch JSONB NOT NULL,
    files_changed INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    reason TEXT,
    -- Reserved candidate origin. Stored at acceptance; the status says when it is live.
    url TEXT,
    submitter TEXT,
    -- Set by the worker when it claims the row, so a crashed build can be reclaimed by age.
    claimed_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT openship_changes_status_check
        CHECK (status IN ('queued', 'building', 'reviewing', 'deployed', 'rejected', 'failed'))
);

-- The buildId is the digest of the resulting tree, so an identical resubmission is the same build.
-- Deduplicating here means a resubmission returns the existing record instead of paying twice.
CREATE UNIQUE INDEX IF NOT EXISTS openship_changes_result_digest_key
    ON openship_changes (result_digest);

CREATE INDEX IF NOT EXISTS openship_changes_queue_idx
    ON openship_changes (status, submitted_at)
    WHERE status IN ('queued', 'building', 'reviewing');

CREATE TRIGGER update_openship_changes_modified_at
    BEFORE UPDATE ON openship_changes
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_at_column();
