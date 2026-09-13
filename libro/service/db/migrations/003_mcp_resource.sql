-- Confidential website clients now request the same MCP resource as agent clients.
-- Revoke old-audience grants instead of silently transferring issued authority.
UPDATE libro_oauth_clients
SET resource = regexp_replace(resource, '/api/v1/?$', '/mcp')
WHERE client_type = 'confidential' AND dynamically_registered = FALSE
  AND resource ~ '/api/v1/?$';

UPDATE libro_oauth_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE resource ~ '/api/v1/?$';

UPDATE libro_oauth_tokens SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE resource ~ '/api/v1/?$';

UPDATE libro_oauth_codes SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP)
WHERE resource ~ '/api/v1/?$';
