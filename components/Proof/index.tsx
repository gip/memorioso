import Editor from '@/components/Editor'
import { Diamond } from '@/components/Diamond'
import { Proof as ProofType, PublicationRecord as PublicationType, Author as AuthorType } from '@/lib/db/objects'
import { WORLD_ID_CREDENTIAL_LABELS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'
import { CopyButton } from './CopyButton'

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const codeToHtml = (code: string) => escapeHtml(code).replace(/\n/g, '<br/>')

const extractHtmlContent = (publication: PublicationType) => {
  return 'html' in publication.publication_content ? publication.publication_content.html : ''
}

const isWorldIdV4Proof = (proof: ProofType): proof is Extract<ProofType, { protocol_version: '4.0' }> => {
  return 'protocol_version' in proof && proof.protocol_version === '4.0'
}

function buildLegacyProofDocument(publication: PublicationType, proof: ProofType) {
  if (isWorldIdV4Proof(proof)) {
    throw new Error('Expected legacy proof')
  }

  const publicationLiteral = `{
  author_id_libro: '${publication.author_id_libro}',
  author_name_libro: "${publication.author_name_libro.replace(/"/g, '\\"')}",
  author_handle_libro: "${publication.author_handle_libro.replace(/"/g, '\\"')}",
  author_bio_libro: "${(publication.author_bio_libro || '').replace(/"/g, '\\"')}",
  publication_title: "${publication.publication_title.replace(/"/g, '\\"')}",
  publication_subtitle: "${publication.publication_subtitle.replace(/"/g, '\\"')}",
  publication_content: { html: "${extractHtmlContent(publication).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" },
  publication_date: '${publication.publication_date}'
}`

  const code = `const { hashSignal } = require('@worldcoin/idkit-core/hashing');

const publication = ${publicationLiteral};
const body = {
  proof: '${proof.proof}',
  merkle_root: '${proof.merkle_root}',
  nullifier_hash: '${proof.nullifier_hash}',
  verification_level: '${proof.verification_level}',
  action: 'written-by-a-human',
  signal_hash: hashSignal(JSON.stringify(publication))
};

const appId = '${process.env.NEXT_PUBLIC_WORLD_ID_LEGACY_APP_ID || 'app_...'}';
const response = await fetch(\`https://developer.worldcoin.org/api/v2/verify/\${appId}\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

console.log(await response.json());`

  return {
    code,
    content: `This document shows how to independently verify the legacy World ID proof of authorship for <i><u>${escapeHtml(publication.publication_title)}</u></i>.
<br/><br/>This publication was signed with the pre-World ID 4.0 flow. The script reconstructs the original publication payload, hashes it into <i>signal_hash</i>, and sends the legacy proof to World's v2 verification endpoint.
<br/><br/><pre><code class="language-javascript">${codeToHtml(code)}</code></pre>`,
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
  const document = isWorldIdV4Proof(proof)
    ? buildWorldIdV4ProofDocument(publication, proof)
    : buildLegacyProofDocument(publication, proof)
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
        <CopyButton codeContent={document.code} />
      </div>
      <Diamond />
    </div>
  );
}
