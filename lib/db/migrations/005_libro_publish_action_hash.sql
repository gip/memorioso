-- Persist the World ID action hash used by the dynamic-action Libro proof registry.

ALTER TABLE libro_publish_registrations
    ADD COLUMN IF NOT EXISTS action_hash VARCHAR(78);
