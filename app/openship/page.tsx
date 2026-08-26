import type { Metadata } from 'next'
import OpenshipViews from '@/components/Openship'
import { openshipOrigin } from '@/lib/openship/http'
import { buildOpenshipInstructions } from '@/lib/openship/instructions'
import { getOpenshipCommit, getOpenshipManifest } from '@/lib/openship/manifest'

export const metadata: Metadata = {
  title: 'Openship — Memorioso',
  description:
    'Memorioso publishes its own source over plain HTTP GET, so any agent can retrieve and rebuild it.',
  alternates: { canonical: '/openship' },
}

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

const HumanView = () => {
  const manifest = getOpenshipManifest()
  const commit = getOpenshipCommit()

  return (
    <div className="space-y-6">
      <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
        <p>
          Memorioso exists because human-authored work should be verifiable rather than taken on
          trust. OpenShip Sources applies the same idea to the software itself. Instead of pointing at a
          repository you would have to go and find, this site serves its own source code — every
          file that makes up the build you are looking at — over ordinary HTTP.
        </p>
        <p>
          There is nothing to install and nothing to sign in to. An agent that knows only the
          address of this site can discover the source, read how the project is structured, fetch
          every file, and rebuild the repository from scratch.
        </p>
      </div>

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
            <dd className="font-mono">{formatBytes(manifest.totals.bytes)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0">Digest</dt>
            <dd className="break-all font-mono">{manifest.digest}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Point an agent at it</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          Give a coding agent this address and it has everything it needs:
        </p>
        <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed sm:text-xs">
          {`${openshipOrigin()}/openship/agent.txt`}
        </pre>
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          Or take the whole thing yourself:
        </p>
        <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed sm:text-xs">
          {`curl -sL ${openshipOrigin()}/openship/source.tar.gz | tar xz`}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">What you get</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          {manifest.project.description}
        </p>
        <ul className="space-y-1 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          {manifest.stack.map(item => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="text-blurple">
                ·
              </span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Openship is a protocol</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          None of this is specific to Memorioso. OpenShip v1 starts with a discovery document and
          a verifiable source snapshot, then optionally adds Changes or Systems. Memorioso implements
          Sources and Changes. The vendored specification is{' '}
          <a
            href="/openship/file/skills/openship/references/openship.md"
            className="underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-blurple"
          >
            openship.md
          </a>
          , served, of course, by the protocol it describes.
        </p>
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
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-blurple">Openship</p>
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
