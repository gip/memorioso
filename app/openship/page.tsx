import type { Metadata } from 'next'
import OpenshipViews from '@/components/Openship'
import { getChangesConfig } from '@/lib/openship/changes-config'
import { openshipOrigin } from '@/lib/openship/http'
import { buildOpenshipInstructions } from '@/lib/openship/instructions'
import {
  getOpenshipCommit,
  getOpenshipManifest,
  OPENSHIP_AGENT,
  OPENSHIP_CAPABILITY_DESCRIPTIONS,
  OPENSHIP_ENDPOINTS,
} from '@/lib/openship/manifest'

export const metadata: Metadata = {
  title: 'OpenShip — Memorioso',
  description:
    'Memorioso publishes its own source over plain HTTP GET, so any agent can retrieve and rebuild it.',
  alternates: { canonical: '/openship' },
}

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

const HumanView = () => {
  const manifest = getOpenshipManifest()
  const commit = getOpenshipCommit()
  const changes = getChangesConfig()
  const mcp = process.env.LIBRO_SERVICE_URL
    ? new URL('/mcp', process.env.LIBRO_SERVICE_URL).toString()
    : null

  return (
    <div className="space-y-6">
      <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
        <p>
          This is {manifest.project.name}&apos;s OpenShip page. OpenShip is a public interface for
          understanding, reproducing, and improving a running project from the project&apos;s own
          origin. Memorioso uses it to publish an integrity-checked source snapshot and the rules
          for proposing isolated candidate changes.
        </p>
        <p>
          This presentation explains those interfaces; the linked discovery and capability JSON
          documents are authoritative.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Project</h2>
        <p className="text-[15px] font-medium text-foreground sm:text-base">
          {manifest.project.name}
        </p>
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          {manifest.project.description}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Start here</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          An unfamiliar agent should first fetch{' '}
          <a
            href="/.well-known/openship.json"
            className="underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-blurple"
          >
            discovery
          </a>{' '}
          and then fetch and read{' '}
          <a
            href={OPENSHIP_ENDPOINTS.skill}
            className="underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-blurple"
          >
            agent.skill
          </a>{' '}
          before interpreting or using any capability link. {OPENSHIP_AGENT.summary}
        </p>
      </section>

      <section className="rounded-xl border bg-muted/30 p-3.5 sm:p-4" aria-label="This build">
        <p className="text-xs font-medium text-foreground">This build</p>
        <dl className="mt-2 space-y-1 text-[11px] text-muted-foreground sm:text-xs">
          {commit ? (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0">Commit</dt>
              <dd className="break-all font-mono">{commit.sha.slice(0, 12)}</dd>
            </div>
          ) : (
            // A tree retrieved over Openship has no git history. Say so rather than showing a
            // blank or an invented commit: the digest below is what identifies this build.
            <div className="flex gap-2">
              <dt className="w-20 shrink-0">Commit</dt>
              <dd className="font-mono">not under version control</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="w-20 shrink-0">Files</dt>
            <dd className="font-mono">{manifest.totals.files}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0">Size</dt>
            <dd className="font-mono">
              {manifest.totals.bytes.toLocaleString()} bytes ({formatBytes(manifest.totals.bytes)})
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0">Digest</dt>
            <dd className="break-all font-mono">{manifest.digest}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Sources</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          {OPENSHIP_CAPABILITY_DESCRIPTIONS.sources}
        </p>
        <ul className="space-y-1 text-sm leading-relaxed text-muted-foreground">
          <li><a className="underline underline-offset-4" href={OPENSHIP_ENDPOINTS.manifest}>Manifest</a> — authoritative file metadata and snapshot digest.</li>
          <li><a className="underline underline-offset-4" href={OPENSHIP_ENDPOINTS.bundle}>Bundle</a> — every declared file and its encoded content.</li>
          <li><a className="underline underline-offset-4" href={OPENSHIP_ENDPOINTS.file}>File template</a> — exact raw content for a manifest path.</li>
          <li><a className="underline underline-offset-4" href={OPENSHIP_ENDPOINTS.archive}>Archive</a> — the complete declared file set.</li>
          <li><a className="underline underline-offset-4" href={OPENSHIP_ENDPOINTS.instructions}>Project instructions</a> — Memorioso-specific retrieval and verification guidance.</li>
          {mcp ? <li><a className="underline underline-offset-4" href={mcp}>MCP binding</a> — public Sources tool and resources.</li> : null}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Changes</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          {OPENSHIP_CAPABILITY_DESCRIPTIONS.changes} This deployment{' '}
          {changes.enabled
            ? 'currently accepts submissions.'
            : 'does not currently accept submissions; the submission endpoint returns 501.'}{' '}
          A candidate result is an isolated preview and is never a production deployment or an
          automatic promotion.
        </p>
        <ul className="space-y-1 text-sm leading-relaxed text-muted-foreground">
          <li><a className="underline underline-offset-4" href={OPENSHIP_ENDPOINTS.policy}>Policy</a> — writable paths, protections, limits, and current availability.</li>
          <li><a className="underline underline-offset-4" href={OPENSHIP_ENDPOINTS.changes}>Submission endpoint</a> — accepts a patch with <code>POST</code>.</li>
          <li><a className="underline underline-offset-4" href={OPENSHIP_ENDPOINTS.changeStatus}>Status template</a> — reports the candidate lifecycle for a change ID.</li>
        </ul>
      </section>
    </div>
  )
}

const AgentView = () => (
  <div className="space-y-3">
    <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
      This is what an agent reads. It is served verbatim at{' '}
      <a
        href="/openship/agent.txt"
        className="underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-blurple"
      >
        /openship/agent.txt
      </a>
      .
    </p>
    <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed sm:text-xs">
      {buildOpenshipInstructions(openshipOrigin())}
    </pre>
  </div>
)

const Page = () => (
  <main className="py-6 sm:py-10 lg:py-12">
    <div className="max-w-2xl">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-blurple">OpenShip</p>
      <h1 className="spectral mt-2 text-3xl font-semibold leading-tight sm:text-4xl">
        This site ships its own source.
      </h1>

      <div className="mt-5 sm:mt-7">
        <OpenshipViews human={<HumanView />} agent={<AgentView />} />
      </div>
    </div>
  </main>
)

export default Page
