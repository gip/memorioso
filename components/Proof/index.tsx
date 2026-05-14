import Editor from '@/components/Editor'
import { Diamond } from '@/components/Diamond'
import { Proof as ProofType, PublicationRecord as PublicationType, Author as AuthorType } from '@/lib/db/objects'
import { WORLD_ID_CREDENTIAL_LABELS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'
import { CopyButton } from './CopyButton'
import {
  isLegacyPublication,
  isWorldIdV4Proof,
  LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE,
} from '@/lib/publication-status'

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const codeToHtml = (code: string) => escapeHtml(code).replace(/\n/g, '<br/>')

function buildLegacyUnavailableDocument(publication: PublicationType) {
  return {
    code: '',
    content: `Independent verification is not available for <i><u>${escapeHtml(publication.publication_title)}</u></i>.
<br/><br/>${escapeHtml(LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE)}`,
  }
}

function buildWorldIdV4ProofDocument(publication: PublicationType, proof: Extract<ProofType, { protocol_version: '4.0' }>) {
  const credentialLabel = WORLD_ID_CREDENTIAL_LABELS[proof.credential_identifier as WorldIdCredentialIdentifier] || proof.credential_identifier
  const rpId = process.env.WORLD_ID_RP_ID || 'rp_...'
  const code = `const { hashSignal } = require('@worldcoin/idkit-core/hashing');

const signalText = ${JSON.stringify(proof.signal_text)};
const expectedSignalHash = ${JSON.stringify(proof.signal_hash)};
const idkitResult = ${JSON.stringify(proof.idkit_result, null, 2)};

if (idkitResult.protocol_version !== '4.0') {
  throw new Error('Expected a World ID 4.0 proof');
}

if (idkitResult.action !== ${JSON.stringify(proof.action)}) {
  throw new Error('Unexpected action');
}

if (idkitResult.nonce !== ${JSON.stringify(proof.nonce)}) {
  throw new Error('Unexpected nonce');
}

const localSignalHash = hashSignal(signalText).toLowerCase();
if (localSignalHash !== expectedSignalHash.toLowerCase()) {
  throw new Error('Stored signal hash does not match the publication signal');
}

for (const response of idkitResult.responses) {
  if (!response.signal_hash || response.signal_hash.toLowerCase() !== localSignalHash) {
    throw new Error('World ID response was not bound to this publication signal');
  }
}

const verifyResponse = await fetch('https://developer.worldcoin.org/api/v4/verify/${rpId}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(idkitResult)
});

console.log(await verifyResponse.json());`

  return {
    code,
    content: `This document shows how to independently verify the World ID 4.0 proof of authorship for <i><u>${escapeHtml(publication.publication_title)}</u></i> by <a href="${process.env.NEXT_PUBLIC_APP_URL}/a/${publication.author_id_libro}">${escapeHtml(publication.author_name_libro)}</a>.
<br/><br/>The signed signal is the exact canonical publication JSON stored below as <i>signalText</i>. World ID 4.0 does not send that content to the verifier directly; it hashes the signal into <i>responses[].signal_hash</i>. Independent verification must recompute that hash locally and confirm every returned credential response is bound to the same publication signal before calling World's v4 verifier.
<br/><br/>Credential used: <strong>${escapeHtml(credentialLabel)}</strong>.
<br/><br/><pre><code class="language-javascript">${codeToHtml(code)}</code></pre>`,
  }
}

export const Proof = ({ publication, proof }: { publication: PublicationType, proof: ProofType }) => {
  const authors: AuthorType[] = [{ id: '0', name: 'Memorioso Team', handle: 'libro' }]
  const title = 'Independent Verification of Human Authorship'
  const document = isLegacyPublication(publication)
    ? buildLegacyUnavailableDocument(publication)
    : isWorldIdV4Proof(proof)
    ? buildWorldIdV4ProofDocument(publication, proof)
    : buildLegacyUnavailableDocument(publication)
  const content = document.content.replace(/\n/g, '')

  return (
    <div className="w-[90%] mx-auto space-y-4 py-4">
      <div className="relative">
        <Editor authors={authors}
          initialContent={content}
          initialTitle={title}
          initialSubtitle={''}
          initialAuthorId={'0'}
          editable={false}
          codeBlocks={true}
        />
        {document.code && <CopyButton codeContent={document.code} />}
      </div>
      <Diamond />
    </div>
  );
}
