-- Every publication feed sorts newest-first. That sort used to read
-- (signal->>'publication_date')::timestamp, which extracts and re-parses JSONB per row
-- and cannot be indexed: text-to-timestamp casting is STABLE, not IMMUTABLE, because it
-- depends on DateStyle. So every feed page was a sequential scan plus a full sort.
--
-- publications.date already holds the same instant: both publish paths insert it from
-- publication_date on the signed payload. Sorting on that column instead makes the
-- ordering plain btree-indexable.

CREATE INDEX IF NOT EXISTS idx_publications_date
    ON publications(date DESC);

-- The author and activity feeds filter before they sort, so give them the filter column
-- first and let the index satisfy the ordering within it.
CREATE INDEX IF NOT EXISTS idx_publications_author_date
    ON publications("authorId", date DESC);

CREATE INDEX IF NOT EXISTS idx_publications_user_date
    ON publications("userId", date DESC);
