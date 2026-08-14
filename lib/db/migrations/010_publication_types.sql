ALTER TABLE drafts
    ADD COLUMN IF NOT EXISTS publication_type VARCHAR(16);

UPDATE drafts
SET publication_type = CASE
    WHEN history->>'source' = 'chrome_extension' THEN 'short'
    ELSE 'article'
END
WHERE publication_type IS NULL;

ALTER TABLE drafts
    ALTER COLUMN publication_type SET DEFAULT 'article',
    ALTER COLUMN publication_type SET NOT NULL;

ALTER TABLE drafts
    ADD CONSTRAINT drafts_publication_type_check
    CHECK (publication_type IN ('short', 'article'));
