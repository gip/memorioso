-- Keep the legacy writer compatible throughout the shadow-copy period.
CREATE OR REPLACE FUNCTION sync_legacy_publication_policy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO publication_policies
    (publication_id, signal_hash, "authorId", access, access_price_usd, created_at, modified_at)
  VALUES (NEW.id, LOWER(COALESCE(NEW.proof->>'signal_hash',
    NEW.proof->'agent_document_signature'->>'document_signal_hash')),
    NEW."authorId", NEW.access, NEW.access_price_usd, NEW.created_at, NEW.modified_at)
  ON CONFLICT (publication_id) DO UPDATE SET
    signal_hash = EXCLUDED.signal_hash, "authorId" = EXCLUDED."authorId",
    access = EXCLUDED.access, access_price_usd = EXCLUDED.access_price_usd,
    modified_at = EXCLUDED.modified_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_legacy_publication_policy ON publications;
CREATE TRIGGER sync_legacy_publication_policy AFTER INSERT OR UPDATE ON publications
FOR EACH ROW EXECUTE FUNCTION sync_legacy_publication_policy();

INSERT INTO publication_policies
  (publication_id, signal_hash, "authorId", access, access_price_usd, created_at, modified_at)
SELECT p.id,
  LOWER(COALESCE(
    p.proof->>'signal_hash',
    p.proof->'agent_document_signature'->>'document_signal_hash'
  )),
  p."authorId", p.access, p.access_price_usd, p.created_at, p.modified_at
FROM publications p
WHERE COALESCE(
  p.proof->>'signal_hash',
  p.proof->'agent_document_signature'->>'document_signal_hash'
) IS NOT NULL
ON CONFLICT (publication_id) DO UPDATE SET
  signal_hash = EXCLUDED.signal_hash,
  "authorId" = EXCLUDED."authorId",
  access = EXCLUDED.access,
  access_price_usd = EXCLUDED.access_price_usd,
  modified_at = EXCLUDED.modified_at;

