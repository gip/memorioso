import pg from 'pg'
import { canonicalPublicationSignal, hashPublicationSignal } from '@libro/core'
import { createHash } from 'node:crypto'

const { Pool } = pg

function argumentsFor(argv) {
  const allowed = new Set(['--dry-run', '--link-source-identities'])
  for (const value of argv) if (!allowed.has(value)) throw new Error(`Unknown argument: ${value}`)
  return { dryRun: argv.includes('--dry-run'), linkSourceIdentities: argv.includes('--link-source-identities') }
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function capHash(id) {
  return createHash('sha256').update(`libro-migration-capability:${id}`).digest('hex')
}

function signalHashFromProof(proof) {
  return proof?.signal_hash || proof?.agent_document_signature?.document_signal_hash || null
}

async function upsertIdentity(target, row) {
  await target.query(
    `INSERT INTO libro_identities
      (id, world_id_session_id, session_commitment, credential_identifier, verified_at, created_at, modified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       world_id_session_id = EXCLUDED.world_id_session_id,
       session_commitment = EXCLUDED.session_commitment,
       credential_identifier = EXCLUDED.credential_identifier,
       verified_at = EXCLUDED.verified_at,
       modified_at = EXCLUDED.modified_at`,
    [row.author_id, row.world_id_session_id, row.world_id_session_commitment,
      row.world_id_credential_identifier || 'proof_of_human', row.modified_at, row.created_at, row.modified_at],
  )
  await target.query(
    `INSERT INTO libro_authors (id, identity_id, name, handle, bio, created_at, modified_at)
     VALUES ($1, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, handle = EXCLUDED.handle,
       bio = EXCLUDED.bio, modified_at = EXCLUDED.modified_at`,
    [row.author_id, row.name, row.author_handle, row.bio, row.author_created_at, row.author_modified_at],
  )
}

async function copyAll(source, target, options) {
  const report = {
    identities: 0, handles: 0, challenges: 0, publications: 0, humanRegistrations: 0,
    agents: 0, agentDocuments: 0, signalMismatches: [], targetCounts: {}, countMismatches: [],
  }
  const identities = await source.query(
    `SELECT u.id AS user_id, u.world_id_session_id, u.world_id_session_commitment,
       u.world_id_credential_identifier, u.created_at, u.modified_at,
       a.id AS author_id, a.name, a.handle AS author_handle, a.bio,
       a.created_at AS author_created_at, a.modified_at AS author_modified_at
     FROM users u JOIN authors a ON a."userId" = u.id
     WHERE u.world_id_session_id IS NOT NULL AND u.world_id_session_commitment IS NOT NULL
     ORDER BY a.id`,
  )
  report.identities = identities.rowCount || 0
  if (!options.dryRun) for (const row of identities.rows) await upsertIdentity(target, row)

  const originClientId = process.env.LIBRO_OAUTH_CLIENT_ID || null
  if (!options.dryRun && originClientId) {
    const secret = required('LIBRO_OAUTH_CLIENT_SECRET')
    const redirectUri = required('LIBRO_OAUTH_REDIRECT_URI')
    const resource = required('LIBRO_OAUTH_RESOURCE')
    const namespace = required('LIBRO_AUTHOR_NAMESPACE')
    await target.query(
      `INSERT INTO libro_oauth_clients
        (id, client_type, secret_hash, redirect_uris, resource, display_name,
         author_namespace, namespace_verified_at, dynamically_registered)
       VALUES ($1, 'confidential', $2, $3, $4, 'Memorioso', $5, CURRENT_TIMESTAMP, FALSE)
       ON CONFLICT (id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash,
         redirect_uris = EXCLUDED.redirect_uris, resource = EXCLUDED.resource,
         author_namespace = EXCLUDED.author_namespace, namespace_verified_at = CURRENT_TIMESTAMP`,
      [originClientId, createHash('sha256').update(secret).digest('hex'), [redirectUri], resource, namespace],
    )
  }

  const handles = await source.query('SELECT * FROM libro_handle_claims ORDER BY created_at, id')
  report.handles = handles.rowCount || 0
  if (!options.dryRun) for (const row of handles.rows) {
    const author = identities.rows.find((item) => item.user_id === row.userId)
    if (!author) throw new Error(`Handle claim ${row.id} has no migratable identity`)
    await target.query(
      `INSERT INTO libro_handle_claims
        (identity_id, handle, handle_hash, session_commitment, transaction_hash, finalized_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (identity_id) DO UPDATE SET transaction_hash = EXCLUDED.transaction_hash,
         finalized_at = EXCLUDED.finalized_at`,
      [author.author_id, row.handle, row.handle_hash, row.session_commitment,
        row.transaction_hash, row.finalized_at, row.created_at],
    )
  }

  const challenges = await source.query(
    `SELECT c.*, a.id AS author_id FROM world_id_publish_challenges c
     JOIN authors a ON a."userId" = c."userId" ORDER BY c.created_at, c.id`,
  )
  report.challenges = challenges.rowCount || 0
  if (!options.dryRun) for (const row of challenges.rows) {
    await target.query(
      `INSERT INTO libro_publish_challenges
        (id, identity_id, author_id, origin_client_id, client_reference, nonce,
         session_commitment, signal_text, signal_hash, publication,
         signing_capability_hash, expires_at, consumed_at, created_at)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET consumed_at = EXCLUDED.consumed_at`,
      [row.id, row.author_id, originClientId, row.draftId, row.nonce, row.session_commitment,
        row.signal_text, row.signal_hash, row.publication, capHash(row.id), row.expires_at,
        row.consumed_at, row.created_at],
    )
  }

  const publications = await source.query('SELECT * FROM publications ORDER BY id')
  report.publications = publications.rowCount || 0
  for (const row of publications.rows) {
    const expected = signalHashFromProof(row.proof)
    const computed = hashPublicationSignal(canonicalPublicationSignal(row.signal))
    if (!expected || expected.toLowerCase() !== computed.toLowerCase()) {
      report.signalMismatches.push({ publicationId: String(row.id), expected, computed })
      continue
    }
    if (!options.dryRun) await target.query(
      `INSERT INTO libro_publications
        (id, author_id, identity_id, origin_client_id, client_reference, signal_hash,
         authorship_class, signal, proof, version, title, subtitle, date, created_at, modified_at)
       VALUES ($1, $2, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET signal_hash = EXCLUDED.signal_hash,
         signal = EXCLUDED.signal, proof = EXCLUDED.proof, modified_at = EXCLUDED.modified_at`,
      [row.id, row.authorId, originClientId, expected.toLowerCase(),
        row.proof?.proof_type === 'human_authorized_agent_signature' ? 'agent' : 'human',
        row.signal, row.proof, row.version, row.title, row.subtitle, row.date, row.created_at, row.modified_at],
    )
  }
  if (report.signalMismatches.length) throw new Error(`Canonical signal mismatch for ${report.signalMismatches.length} publication(s)`)

  const human = await source.query('SELECT * FROM libro_publish_registrations ORDER BY created_at, id')
  report.humanRegistrations = human.rowCount || 0
  if (!options.dryRun) for (const row of human.rows) {
    await target.query(
      `INSERT INTO libro_human_registrations
        (id, challenge_id, signal_hash, handle_hash, session_commitment, session_nullifier,
         chain_id, registry_address, proof, transaction, submission_method, user_op_hash,
         transaction_hash, publication_id, finalized_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET transaction_hash = EXCLUDED.transaction_hash,
         publication_id = EXCLUDED.publication_id, finalized_at = EXCLUDED.finalized_at`,
      [row.id, row.challengeId, row.signal_hash, row.handle_hash, row.session_commitment,
        row.session_nullifier, row.chain_id, row.registry_address, row.proof, row.transaction,
        row.proof?.libro_registration?.submission_method || null, row.user_op_hash,
        row.transaction_hash, row.publicationId, row.finalized_at, row.created_at],
    )
  }

  const agents = await source.query('SELECT * FROM libro_agent_registrations ORDER BY created_at, id')
  report.agents = agents.rowCount || 0
  if (!options.dryRun) for (const row of agents.rows) await target.query(
    `INSERT INTO libro_agent_registrations
      (id, identity_id, author_id, origin_client_id, author_reference, registration_hash,
       handle_hash, session_commitment, controller_address, agent_address, scope, valid_from,
       expires_at, nonce, signal, signal_hash, payload, signing_capability_hash, proof, chain_id, registry_address,
       transaction, user_op_hash, transaction_hash, finalized_at, revoked_at, created_at)
     VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     ON CONFLICT (id) DO UPDATE SET proof = EXCLUDED.proof, transaction_hash = EXCLUDED.transaction_hash,
       finalized_at = EXCLUDED.finalized_at, revoked_at = EXCLUDED.revoked_at`,
    [row.id, row.authorId, originClientId, row.payload?.author_reference || null,
      row.registration_hash, row.handle_hash, row.session_commitment, row.controller_address,
      row.agent_address, String(row.scope), row.valid_from, row.expires_at, row.nonce,
      row.signal, row.signal_hash, row.payload, capHash(row.id), row.proof, row.chain_id, row.registry_address,
      row.transaction, row.user_op_hash, row.transaction_hash, row.finalized_at, row.revoked_at, row.created_at],
  )

  const documents = await source.query('SELECT * FROM libro_agent_document_registrations ORDER BY created_at, id')
  report.agentDocuments = documents.rowCount || 0
  if (!options.dryRun) for (const row of documents.rows) await target.query(
    `INSERT INTO libro_agent_documents
      (id, registration_id, publication_id, registration_hash, handle_hash, document_signal_hash,
       document_signal_text, document_nonce, signed_at, agent_address, agent_signature,
       publication, proof, chain_id, registry_address, transaction, user_op_hash,
       transaction_hash, finalized_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (id) DO UPDATE SET publication_id = EXCLUDED.publication_id,
       proof = EXCLUDED.proof, transaction_hash = EXCLUDED.transaction_hash,
       finalized_at = EXCLUDED.finalized_at`,
    [row.id, row.registrationId, row.publicationId, row.registration_hash, row.handle_hash,
      row.document_signal_hash, row.document_signal_text, row.document_nonce, row.signed_at,
      row.agent_address, row.agent_signature, row.publication, row.proof, row.chain_id,
      row.registry_address, row.transaction, row.user_op_hash, row.transaction_hash,
      row.finalized_at, row.created_at],
  )

  const targetTables = {
    identities: 'libro_identities',
    handles: 'libro_handle_claims',
    challenges: 'libro_publish_challenges',
    publications: 'libro_publications',
    humanRegistrations: 'libro_human_registrations',
    agents: 'libro_agent_registrations',
    agentDocuments: 'libro_agent_documents',
  }
  for (const [entity, table] of Object.entries(targetTables)) {
    const count = Number((await target.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0]?.count || 0)
    report.targetCounts[entity] = count
    if (!options.dryRun && count !== report[entity]) {
      report.countMismatches.push({ entity, source: report[entity], target: count })
    }
  }
  if (report.countMismatches.length) {
    throw new Error(`Target row-count mismatch for ${report.countMismatches.map((item) => item.entity).join(', ')}`)
  }

  if (!options.dryRun) {
    await target.query(`SELECT setval(pg_get_serial_sequence('libro_publications','id'),
      COALESCE((SELECT MAX(id) FROM libro_publications), 1),
      EXISTS (SELECT 1 FROM libro_publications))`)
    for (const [entity, count] of Object.entries(report)) {
      if (typeof count !== 'number') continue
      await target.query(
        `INSERT INTO libro_copy_checkpoints (entity, source_count, report)
         VALUES ($1, $2, $3) ON CONFLICT (entity) DO UPDATE SET
           source_count = EXCLUDED.source_count, copied_at = CURRENT_TIMESTAMP, report = EXCLUDED.report`,
        [entity, count, { dryRun: false }],
      )
    }
    if (options.linkSourceIdentities) {
      for (const row of identities.rows) await source.query(
        'UPDATE users SET libro_identity_id = $1 WHERE id = $2 AND libro_identity_id IS DISTINCT FROM $1',
        [row.author_id, row.user_id],
      )
    }
  }
  return report
}

async function main() {
  const options = argumentsFor(process.argv.slice(2))
  const source = new Pool({ connectionString: required('SOURCE_DATABASE_URL'), max: 1, application_name: 'libro-copy-source' })
  const target = new Pool({ connectionString: required('LIBRO_DATABASE_URL'), max: 1, application_name: 'libro-copy-target' })
  const sourceClient = await source.connect()
  const targetClient = await target.connect()
  try {
    await sourceClient.query(options.linkSourceIdentities
      ? 'BEGIN ISOLATION LEVEL REPEATABLE READ'
      : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    if (!options.dryRun) await targetClient.query('BEGIN')
    const report = await copyAll(sourceClient, targetClient, options)
    if (!options.dryRun) await targetClient.query('COMMIT')
    await sourceClient.query('COMMIT')
    console.log(JSON.stringify({ mode: options.dryRun ? 'dry-run' : 'copy', ...report }, null, 2))
  } catch (error) {
    if (!options.dryRun) await targetClient.query('ROLLBACK').catch(() => {})
    await sourceClient.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    sourceClient.release()
    targetClient.release()
    await source.end()
    await target.end()
  }
}

await main()
