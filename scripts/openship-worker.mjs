#!/usr/bin/env node
// The build host. Gates 6, 7, and 8 of OPENSHIP-CHANGES.md.
//
// Run it as:
//   node --import ./scripts/openship-resolve.mjs scripts/openship-worker.mjs [--once]
//
// The shape that matters is the split between where submitted code runs and where the deployment
// token lives. `next build` executes whatever the submission contains — a next.config.ts is a
// program — so it runs inside a disposable container with no secret and, past the install step, no
// network. The token stays in this process and is only ever passed to `vercel deploy`, which never
// runs submitted code. Nothing else in this file is load-bearing for security; that is.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  claimOpenshipChange,
  updateOpenshipChangeStatus,
} from '@/lib/db/openship-changes'
import { buildIdOf } from '@/lib/openship/change'
import { validateChange } from '@/lib/openship/validate'
import { reviewChange } from './openship-review.mjs'

const run = promisify(execFile)

const SOURCE_ORIGIN = (process.env.OPENSHIP_SOURCE_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? '')
  .replace(/\/$/, '')
const BUILDS_DOMAIN = process.env.OPENSHIP_BUILDS_DOMAIN
const SANDBOX = process.env.OPENSHIP_SANDBOX
const SANDBOX_IMAGE = process.env.OPENSHIP_SANDBOX_IMAGE ?? 'node:24-bookworm'
const PNPM_STORE = process.env.OPENSHIP_PNPM_STORE
const VERCEL_TOKEN = process.env.VERCEL_TOKEN
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID
const VERCEL_ORG_ID = process.env.VERCEL_ORG_ID
const POLL_SECONDS = Number(process.env.OPENSHIP_WORKER_POLL_SECONDS ?? 15)

const log = (...parts) => console.log('[openship-worker]', ...parts)

class GateFailure extends Error {
  constructor(gate, message) {
    super(message)
    this.gate = gate
  }
}

/**
 * Refuses to start rather than silently running submitted code on the host. Every one of these is
 * a condition OPENSHIP-CHANGES.md states as a requirement, so the check belongs here and not in a
 * paragraph someone reads once.
 */
const checkConfiguration = () => {
  const missing = []
  if (!SOURCE_ORIGIN) missing.push('OPENSHIP_SOURCE_ORIGIN (or NEXT_PUBLIC_APP_URL)')
  if (!BUILDS_DOMAIN) missing.push('OPENSHIP_BUILDS_DOMAIN')
  if (!VERCEL_TOKEN) missing.push('VERCEL_TOKEN')
  if (!VERCEL_PROJECT_ID) missing.push('VERCEL_PROJECT_ID')
  if (!VERCEL_ORG_ID) missing.push('VERCEL_ORG_ID')
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`)
  }

  if (SANDBOX !== 'docker' && SANDBOX !== 'none') {
    throw new Error(
      'Set OPENSHIP_SANDBOX=docker to build submitted code in a container.\n' +
        'OPENSHIP_SANDBOX=none runs it directly on this host with this process\'s environment, ' +
        'including VERCEL_TOKEN. Only use it on a machine you are willing to treat as disposable.'
    )
  }
  if (SANDBOX === 'none') {
    log('WARNING: OPENSHIP_SANDBOX=none. Submitted code will run on this host.')
  }
}

// --- Gate 6: build -----------------------------------------------------------------------------

/**
 * Runs one command against the materialised tree. Under docker the tree is the only thing mounted,
 * the environment is an explicit allowlist rather than whatever this process happens to hold, and
 * `network: false` is the default: only the install step has any business reaching the network.
 */
const sandboxed = async (cwd, command, { network = false, timeoutMs = 15 * 60_000 } = {}) => {
  if (SANDBOX === 'none') {
    return run('sh', ['-lc', command], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      // Even in the escape hatch, the token does not go near submitted code.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: '1', NODE_ENV: 'production' },
    })
  }

  const args = [
    'run', '--rm',
    '--workdir', '/work',
    '--volume', `${cwd}:/work`,
    ...(PNPM_STORE ? ['--volume', `${PNPM_STORE}:/pnpm-store`] : []),
    ...(network ? [] : ['--network', 'none']),
    // A submitted build is not entitled to the host's resources, and a fork bomb is a change too.
    '--memory', process.env.OPENSHIP_SANDBOX_MEMORY ?? '4g',
    '--cpus', process.env.OPENSHIP_SANDBOX_CPUS ?? '2',
    '--pids-limit', '2048',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--env', 'CI=1',
    '--env', 'NODE_ENV=production',
    '--env', 'HOME=/work',
    ...(PNPM_STORE ? ['--env', 'PNPM_STORE_DIR=/pnpm-store'] : []),
    SANDBOX_IMAGE,
    'bash', '-lc', command,
  ]

  return run('docker', args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 })
}

const buildTree = async (cwd) => {
  const steps = [
    // The lockfile is protected by policy, so --frozen-lockfile is an assertion rather than a hope.
    // --ignore-scripts is what stops a dependency's postinstall from being the attack.
    {
      name: 'install',
      command: 'corepack enable && pnpm install --frozen-lockfile --ignore-scripts --prefer-offline',
      network: true,
    },
    // The Openship payload is generated, not source, so it is not in the tree we just wrote and
    // has to be regenerated. Doing so is what makes this build serve its own source: a build of a
    // change can itself be retrieved and changed. It needs no git — the file set comes from the
    // openship.json that materialize() wrote.
    { name: 'openship', command: 'node scripts/build-openship.mjs' },
    { name: 'typecheck', command: 'pnpm exec tsc --noEmit' },
    { name: 'lint', command: 'pnpm lint' },
    { name: 'test', command: 'pnpm test' },
    { name: 'build', command: 'pnpm exec vercel build --yes' },
  ]

  const passed = []
  for (const step of steps) {
    log(`  gate 6 · ${step.name}`)
    try {
      await sandboxed(cwd, step.command, { network: step.network })
      passed.push(step.name)
    } catch (error) {
      const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim()
      throw new GateFailure(
        'build',
        `${step.name} failed.\n${output.slice(-4000) || error.message}`
      )
    }
  }
  return passed
}

// --- Gate 8: deploy ----------------------------------------------------------------------------

/**
 * Uploads the prebuilt output and points the buildId subdomain at it. This is the only place the
 * deployment token is used, and no submitted code has run in this process. `--prebuilt` means
 * Vercel does not build: it serves what the sandbox produced, so no build minutes are spent and an
 * untrusted change can never queue behind a real deploy.
 */
const deploy = async (cwd, buildId) => {
  const env = { ...process.env, VERCEL_PROJECT_ID, VERCEL_ORG_ID }

  const { stdout } = await run(
    'pnpm',
    ['exec', 'vercel', 'deploy', '--prebuilt', '--archive=tgz', '--yes', '--token', VERCEL_TOKEN],
    { cwd, env, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 }
  )

  const deploymentUrl = stdout.trim().split('\n').filter(Boolean).pop()
  if (!deploymentUrl?.startsWith('https://')) {
    throw new GateFailure('deploy', `Could not read a deployment URL from: ${stdout.slice(-500)}`)
  }

  const alias = `${buildId}.${BUILDS_DOMAIN}`
  await run(
    'pnpm',
    ['exec', 'vercel', 'alias', 'set', deploymentUrl, alias, '--token', VERCEL_TOKEN],
    { cwd, env, timeout: 5 * 60_000 }
  )

  return `https://${alias}`
}

// --- Orchestration -----------------------------------------------------------------------------

/** The base tree, fetched over the same public endpoints any other client would use. */
const fetchBase = async () => {
  const [manifest, bundle] = await Promise.all([
    fetch(`${SOURCE_ORIGIN}/openship/manifest.json`).then((response) => response.json()),
    fetch(`${SOURCE_ORIGIN}/openship/bundle.json`).then((response) => response.json()),
  ])
  return { manifest, bundle }
}

const materialize = async (cwd, manifest, bundle, patch) => {
  const contents = new Map()
  for (const file of manifest.files) {
    const entry = bundle.files[file.path]
    contents.set(file.path, Buffer.from(entry.content, entry.encoding === 'base64' ? 'base64' : 'utf8'))
  }
  for (const [filePath, body] of patch) {
    if (body === null) contents.delete(filePath)
    else contents.set(filePath, body)
  }

  for (const [filePath, body] of contents) {
    const absolute = path.join(cwd, filePath)
    // The path was normalised by the validator, but a check that costs nothing guards against a
    // future caller that skipped it.
    if (!absolute.startsWith(`${cwd}${path.sep}`)) {
      throw new GateFailure('build', `Refusing to write outside the tree: ${filePath}`)
    }
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, body)
  }

  // The checked-in manifest is the file set, so the build host writes one describing exactly the
  // tree it just materialised. Every entry is a plain file: applyChange never produces a symlink,
  // and the bundle serves a symlink's resolved content, so what landed on disk is a regular file
  // even where the base manifest declared a link. Declaring it honestly is what lets
  // `pnpm openship:check` pass inside the sandbox.
  //
  // openship.json is not in files[] — it describes the tree rather than belonging to it — which is
  // also why regenerating it here cannot move the digest the endpoint already computed.
  const { project, stack, structure, setup, ignore, ignoreNames } = manifest
  await writeFile(
    path.join(cwd, 'openship.json'),
    `${JSON.stringify(
      {
        openship: manifest.openship,
        project,
        stack,
        structure,
        setup,
        ignore,
        ignoreNames,
        files: [...contents.keys()].sort().map((filePath) => ({ path: filePath })),
      },
      null,
      2
    )}\n`
  )

  await mkdir(path.join(cwd, '.vercel'), { recursive: true })
  // projectId and orgId identify the project; neither is a credential. The token is not written.
  await writeFile(
    path.join(cwd, '.vercel', 'project.json'),
    JSON.stringify({ projectId: VERCEL_PROJECT_ID, orgId: VERCEL_ORG_ID })
  )

  return contents
}

const processChange = async (change) => {
  log(`change ${change.changeId} · build ${change.buildId} · "${change.title}"`)

  const { manifest, bundle } = await fetchBase()

  // Re-validation, from the same module the endpoint used. The submission was accepted against the
  // digest it named; if production has moved on since, the change has to be rebased rather than
  // built against a tree its author never read.
  const submission = {
    openship: '1.0',
    base: change.base,
    title: change.title,
    intent: change.intent,
    files: change.patch,
  }
  const revalidated = validateChange(submission, {
    base: manifest.files,
    baseDigest: manifest.digest,
    mediaTypeOf: (filePath) =>
      manifest.files.find((file) => file.path === filePath)?.mediaType ??
      'text/plain; charset=utf-8',
  })

  if (!revalidated.ok) {
    const summary = revalidated.violations
      .map((item) => `${item.path ?? '-'}: ${item.rule} — ${item.message}`)
      .join('\n')
    throw new GateFailure('revalidate', `Re-validation failed against ${manifest.digest}:\n${summary}`)
  }
  if (revalidated.tree.buildId !== change.buildId) {
    throw new GateFailure(
      'revalidate',
      `The tree now hashes to ${revalidated.tree.buildId}, not ${change.buildId}. Rebase and resubmit.`
    )
  }

  const cwd = await mkdtemp(path.join(tmpdir(), `openship-${change.buildId}-`))
  try {
    await materialize(cwd, manifest, bundle, revalidated.patch)

    const gatesPassed = await buildTree(cwd)

    // Gate 7 runs after the build, so the reviewer is told what actually compiled rather than what
    // was claimed, and so a change that does not build never costs a review.
    log('  gate 7 · review')
    await updateOpenshipChangeStatus(change.changeId, 'reviewing')

    const baseByPath = new Map(manifest.files.map((file) => [file.path, file.size]))
    const review = await reviewChange({
      title: change.title,
      intent: change.intent,
      files: revalidated.changedPaths.map((filePath) => ({
        path: filePath,
        body: revalidated.patch.get(filePath) ?? null,
        existed: baseByPath.get(filePath) ?? 0,
      })),
      gateResults: [
        `paths, size, and content rules passed against base ${manifest.digest}`,
        `build gates passed: ${gatesPassed.join(', ')}`,
        `${revalidated.changedPaths.length} file(s) changed`,
      ],
    })

    if (review.verdict !== 'approve') {
      log(`  rejected: ${review.reason}`)
      await updateOpenshipChangeStatus(change.changeId, 'rejected', { reason: review.reason })
      return
    }

    log('  gate 8 · deploy')
    const url = await deploy(cwd, change.buildId)
    await updateOpenshipChangeStatus(change.changeId, 'deployed', {
      url,
      reason: review.concerns.length > 0 ? `Approved with notes: ${review.concerns.join('; ')}` : null,
    })
    log(`  deployed ${url}`)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

const tick = async () => {
  const change = await claimOpenshipChange()
  if (!change) return false

  try {
    await processChange(change)
  } catch (error) {
    const gate = error instanceof GateFailure ? error.gate : 'worker'
    log(`  failed at ${gate}: ${error.message.split('\n')[0]}`)
    await updateOpenshipChangeStatus(change.changeId, 'failed', {
      reason: `${gate}: ${error.message}`.slice(0, 8000),
    })
  }
  return true
}

const main = async () => {
  checkConfiguration()
  if (buildIdOf('sha256:0123456789abcdef').length !== 12) {
    throw new Error('buildIdOf did not load correctly; check the @/ resolver hook.')
  }
  if (!existsSync(path.join(process.cwd(), 'package.json'))) {
    throw new Error('Run the worker from the repository root.')
  }

  const once = process.argv.includes('--once')
  log(`sandbox=${SANDBOX} source=${SOURCE_ORIGIN} builds=${BUILDS_DOMAIN}${once ? ' (once)' : ''}`)

  for (;;) {
    const worked = await tick()
    if (once) return
    if (!worked) await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000))
  }
}

main().catch((error) => {
  console.error('[openship-worker]', error.message)
  process.exit(1)
})
