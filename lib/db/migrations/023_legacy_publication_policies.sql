-- Legacy proofs have no stored signal hash. The copy command installs their derived
-- lookup hash without modifying the signed payload or the historical proof.
CREATE OR REPLACE FUNCTION sync_legacy_publication_policy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE policy_hash TEXT;
BEGIN
  policy_hash := LOWER(COALESCE(NEW.proof->>'signal_hash',
    NEW.proof->'agent_document_signature'->>'document_signal_hash',
    (SELECT signal_hash FROM publication_policies WHERE publication_id = NEW.id)));
  IF policy_hash IS NULL THEN RETURN NEW; END IF;
  INSERT INTO publication_policies
    (publication_id, signal_hash, "authorId", access, access_price_usd, created_at, modified_at)
  VALUES (NEW.id, policy_hash, NEW."authorId", NEW.access, NEW.access_price_usd, NEW.created_at, NEW.modified_at)
  ON CONFLICT (publication_id) DO UPDATE SET
    signal_hash = EXCLUDED.signal_hash, "authorId" = EXCLUDED."authorId",
    access = EXCLUDED.access, access_price_usd = EXCLUDED.access_price_usd,
    modified_at = EXCLUDED.modified_at;
  RETURN NEW;
END;
$$;
