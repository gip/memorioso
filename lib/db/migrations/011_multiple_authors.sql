ALTER TABLE authors
    DROP CONSTRAINT IF EXISTS "authors_userId_key";

CREATE INDEX IF NOT EXISTS idx_authors_user
    ON authors("userId");

CREATE OR REPLACE FUNCTION enforce_author_limit()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM 1 FROM users WHERE id = NEW."userId" FOR UPDATE;

    IF (SELECT COUNT(*) FROM authors WHERE "userId" = NEW."userId") >= 5 THEN
        RAISE EXCEPTION 'A Memorioso account can have at most five authors'
            USING ERRCODE = '23514', CONSTRAINT = 'authors_per_user_limit';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_authors_per_user_limit ON authors;
CREATE TRIGGER enforce_authors_per_user_limit
    BEFORE INSERT ON authors
    FOR EACH ROW
    EXECUTE FUNCTION enforce_author_limit();

CREATE OR REPLACE FUNCTION validate_draft_user_matches_author()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."authorId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM authors
        WHERE id = NEW."authorId" AND "userId" = NEW."userId"
    ) THEN
        RAISE EXCEPTION 'Draft user must match author user'
            USING ERRCODE = '23514', CONSTRAINT = 'draft_user_matches_author';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_draft_user_matches_author ON drafts;
CREATE TRIGGER enforce_draft_user_matches_author
    BEFORE INSERT OR UPDATE OF "userId", "authorId" ON drafts
    FOR EACH ROW
    EXECUTE FUNCTION validate_draft_user_matches_author();
