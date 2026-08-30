import { getSigningChallenge } from '@/lib/human-publications'
import { SigningClient } from './SigningClient'

export const instant = false

export default async function SigningPage({ params }: { params: Promise<{ capability: string }> }) {
  const { capability } = await params
  const challenge = await getSigningChallenge(capability)
  const publication = challenge.publication as {
    publication_title: string
    publication_subtitle: string
    publication_content: { html: string }
    author_name_libro: string
    author_handle_libro: string
  }
  return (
    <main>
      <div className="card">
        <p className="muted">Libro human publication</p>
        <h1>{publication.publication_title || 'Untitled short'}</h1>
        {publication.publication_subtitle && <p>{publication.publication_subtitle}</p>}
        <p>By {publication.author_name_libro} (@{publication.author_handle_libro})</p>
        <p className="muted">Signal hash: {challenge.signal_hash}</p>
        <h2>Complete signed body</h2>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{publication.publication_content.html}</pre>
        <SigningClient capability={capability} />
      </div>
    </main>
  )
}
