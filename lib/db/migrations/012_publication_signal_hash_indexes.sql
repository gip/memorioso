CREATE INDEX IF NOT EXISTS idx_publications_world_id_signal_hash
    ON publications ((LOWER(proof->>'signal_hash')));

CREATE INDEX IF NOT EXISTS idx_publications_agent_document_signal_hash
    ON publications ((LOWER(proof->'agent_document_signature'->>'document_signal_hash')));
