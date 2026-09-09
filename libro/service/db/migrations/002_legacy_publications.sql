-- Historical authors have no invented World ID session and cannot authenticate.
ALTER TABLE libro_authors ALTER COLUMN identity_id DROP NOT NULL;
ALTER TABLE libro_publications ALTER COLUMN identity_id DROP NOT NULL;
ALTER TABLE libro_publications ADD COLUMN legacy_proof BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE libro_publications ADD CONSTRAINT libro_publications_identity_class_check
  CHECK (legacy_proof OR identity_id IS NOT NULL);
ALTER TABLE libro_publications ADD CONSTRAINT libro_publications_legacy_shape_check
  CHECK (NOT legacy_proof OR (
    authorship_class = 'human' AND NOT (signal ? 'publication_schema')
    AND proof->>'verification_level' = 'orb'
    AND proof ?& ARRAY['proof', 'merkle_root', 'nullifier_hash', 'verification_level']
  ));
