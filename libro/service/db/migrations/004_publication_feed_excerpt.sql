-- Derived presentation data stays outside the canonical signed payload.
-- Existing rows are filled from their exact HTML on their first feed read.
ALTER TABLE libro_publications ADD COLUMN feed_excerpt TEXT;

CREATE FUNCTION clear_libro_publication_feed_excerpt() RETURNS trigger AS $$
BEGIN
  IF OLD.signal IS DISTINCT FROM NEW.signal THEN
    NEW.feed_excerpt := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clear_libro_publication_feed_excerpt
  BEFORE UPDATE OF signal ON libro_publications
  FOR EACH ROW EXECUTE FUNCTION clear_libro_publication_feed_excerpt();
