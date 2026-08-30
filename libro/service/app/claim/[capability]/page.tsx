import { getHandleClaimSigningRequest } from '@/lib/handle-claims'
import { ClaimClient } from './ClaimClient'

export const instant = false

export default async function ClaimPage({ params }: { params: Promise<{ capability: string }> }) {
  const { capability } = await params
  const row = await getHandleClaimSigningRequest(capability)
  return <main><div className="card">
    <p className="muted">Libro handle claim</p>
    <h1>Claim @{row.handle}</h1>
    <p>This permanently binds the handle to your fixed Libro session commitment.</p>
    <p className="muted">Handle hash: {row.handle_hash}</p>
    <ClaimClient capability={capability} signal={row.signal_text} />
  </div></main>
}
