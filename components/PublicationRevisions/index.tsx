import Link from 'next/link'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { pool } from '@/lib/db'
import { getPublicationVersionStatus, getPublicationVersions, getPublicationRevision } from '@/lib/publication-revisions'
import { publicationPath } from '@/lib/publication-kind'
import { PublicationTimestamp } from '@/components/PublicationTimestamp'

export async function PublicationRevisions({ publicationId, handle }: { publicationId: string; handle: string }) {
  let info
  let available = true
  try { info = await getPublicationVersionStatus(publicationId) }
  catch { available = false; info = await getPublicationRevision(publicationId) }
  if (!info) return null
  const versions = await getPublicationVersions(publicationId)
  const [user] = await Promise.all([getAuthenticatedUser()])
  const owner = user ? (await pool.query('SELECT id FROM authors WHERE handle = $1 AND "userId" = $2', [handle, user.id])).rows.length > 0 : false
  const current = versions.find(version => version.publicationId === publicationId)
  const latest = versions.find(version => version.publicationId === info.latestPublicationId)
  return <section aria-label="Publication versions" className="mb-5 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 text-sm">
    <p className="text-muted-foreground">Initially published <PublicationTimestamp date={info.initiallyPublishedAt} style="short" /> · Version {info.revisionNumber}</p>
    {info.revisionNumber > 1 && current && <p className="text-muted-foreground">Updated <PublicationTimestamp date={current.publicationDate} style="short" /></p>}
    {!available ? <p className="text-muted-foreground">Latest version status is temporarily unavailable.</p> : !info.isLatest && (latest
      ? <p><Link className="font-medium text-blurple hover:underline" href={publicationPath(latest.publicationType, latest.publicationId)}>A newer version is available →</Link></p>
      : <p>A newer version is registered. Its publication is being finalized.</p>)}
    {owner && available && info.isLatest && <Link className="inline-block font-medium text-blurple hover:underline" href={`/d/new?revise=${publicationId}`}>Publish new version</Link>}
    {versions.length > 1 && <details><summary className="cursor-pointer text-muted-foreground">Version history</summary><ol className="mt-2 space-y-1">{versions.map(version => <li key={version.publicationId}><Link className="text-blurple hover:underline" href={publicationPath(version.publicationType, version.publicationId)}>Version {version.revisionNumber}</Link> · <PublicationTimestamp date={version.publicationDate} style="short" />{version.publicationId === publicationId && ' · This version'}</li>)}</ol></details>}
  </section>
}
