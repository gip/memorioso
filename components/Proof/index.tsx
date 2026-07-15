import Editor from '@/components/Editor'
import { Diamond } from '@/components/Diamond'
import { Proof as ProofType, PublicationRecord as PublicationType, Author as AuthorType } from '@/lib/db/objects'
import { WORLD_ID_CREDENTIAL_LABELS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'
import { CopyButton } from './CopyButton'
import {
  isLegacyPublication,
  isLibroAgentProof,
  isLibroRegisteredProof,
  isWorldIdV4Proof,
  LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE,
} from '@/lib/publication-status'

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const codeToHtml = (code: string) => escapeHtml(code).replace(/\n/g, '<br/>')

const signalJsonDeclaration = (signalText: string) => `const signalJson = ${JSON.stringify(JSON.parse(signalText), null, 2)};
const signalText = JSON.stringify(signalJson);`

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
  const code = `const { hashSignal } = require('@worldcoin/idkit/hashing');

${signalJsonDeclaration(proof.signal_text)}
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
    content: `This World ID 4.0 proof for <i><u>${escapeHtml(publication.publication_title)}</u></i> by <a href="${process.env.NEXT_PUBLIC_APP_URL}/a/${publication.author_id_libro}">${escapeHtml(publication.author_name_libro)}</a> was stored before Libro on-chain registration was enabled.
<br/><br/><strong>Libro registration:</strong> not registered on-chain.
<br/><br/>The signed signal is the exact canonical publication JSON stored below as <i>signalJson</i> and converted to <i>signalText</i> with <i>JSON.stringify</i>. World ID 4.0 does not send that content to the verifier directly; it hashes the signal into <i>responses[].signal_hash</i>. Independent verification must recompute that hash locally and confirm every returned credential response is bound to the same publication signal before calling World's v4 verifier.
<br/><br/>Credential used: <strong>${escapeHtml(credentialLabel)}</strong>.
<br/><br/><pre><code class="language-javascript">${codeToHtml(code)}</code></pre>`,
  }
}

function buildLibroProofDocument(publication: PublicationType, proof: Extract<ProofType, { protocol_version: '4.0' }> & { libro_registration: NonNullable<Extract<ProofType, { protocol_version: '4.0' }>['libro_registration']> }) {
  const credentialLabel = WORLD_ID_CREDENTIAL_LABELS[proof.credential_identifier as WorldIdCredentialIdentifier] || proof.credential_identifier
  const registration = proof.libro_registration
  const code = `const { createPublicClient, http } = require('viem');
const { worldchain } = require('viem/chains');
const { hashSignal } = require('@worldcoin/idkit/hashing');

const libroProofRegistryAbi = [{
  type: 'function',
  name: 'verify',
  stateMutability: 'view',
  inputs: [{ name: 'signalHash', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}];

${signalJsonDeclaration(proof.signal_text)}
const expectedSignalHash = ${JSON.stringify(registration.signal_hash)};
const registryAddress = ${JSON.stringify(registration.registry_address)};

const localSignalHash = hashSignal(signalText).toLowerCase();
if (localSignalHash !== expectedSignalHash.toLowerCase()) {
  throw new Error('Stored signal hash does not match the publication signal');
}

const client = createPublicClient({
  chain: worldchain,
  transport: http('https://worldchain-mainnet.g.alchemy.com/public'),
});

const registered = await client.readContract({
  address: registryAddress,
  abi: libroProofRegistryAbi,
  functionName: 'verify',
  args: [BigInt(expectedSignalHash)],
});

if (!registered) {
  throw new Error('Libro registry does not contain this publication signal');
}

console.log({ registered, signalHash: expectedSignalHash });`

  return {
    code,
    content: `This document shows how to independently verify the Libro on-chain proof of human authorship for <i><u>${escapeHtml(publication.publication_title)}</u></i> by <a href="${process.env.NEXT_PUBLIC_APP_URL}/a/${publication.author_id_libro}">${escapeHtml(publication.author_name_libro)}</a>.
<br/><br/>The signed signal is the exact canonical publication JSON stored below as <i>signalJson</i> and converted to <i>signalText</i> with <i>JSON.stringify</i>. Libro stores the signal hash on World Chain after the World ID 4.0 proof is verified by the registry contract. Anyone can call the registry with a valid proof; MiniKit is only a sponsored-gas path used by Memorioso.
<br/><br/>Credential used: <strong>${escapeHtml(credentialLabel)}</strong>.
<br/><br/>Chain ID: <strong>${registration.chain_id}</strong>.
<br/>Registry: <code>${escapeHtml(registration.registry_address)}</code>.
<br/>Signal hash: <code>${escapeHtml(registration.signal_hash)}</code>.
<br/>Action hash: <code>${escapeHtml(registration.action_hash || 'unknown')}</code>.
<br/>User operation: <code>${escapeHtml(registration.user_op_hash)}</code>.
<br/>Transaction: <code>${escapeHtml(registration.transaction_hash)}</code>.
<br/><br/><pre><code class="language-javascript">${codeToHtml(code)}</code></pre>`,
  }
}

function buildLibroAgentProofDocument(
  publication: PublicationType,
  proof: Extract<ProofType, { proof_type: 'human_authorized_agent_signature' }>
) {
  const registration = proof.agent_registration
  const document = proof.agent_document_signature
  const code = `const { createPublicClient, http, recoverTypedDataAddress } = require('viem');
const { worldchain } = require('viem/chains');
const { hashSignal } = require('@worldcoin/idkit/hashing');

const libroAgentRegistryAbi = [{
  type: 'function',
  name: 'verifyAgentDocument',
  stateMutability: 'view',
  inputs: [{ name: 'documentSignalHash', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}];

${signalJsonDeclaration(document.document_signal_text)}
const expectedSignalHash = ${JSON.stringify(document.document_signal_hash)};
const registryAddress = ${JSON.stringify(document.registry_address)};
const registrationHash = ${JSON.stringify(registration.registration_hash)};
const documentNonce = ${JSON.stringify(document.document_nonce)};
const signedAt = BigInt(${JSON.stringify(Math.floor(new Date(document.signed_at).getTime() / 1000))});
const signature = ${JSON.stringify(document.signature)};
const expectedAgent = ${JSON.stringify(document.agent_address)};

const localSignalHash = hashSignal(signalText).toLowerCase();
if (localSignalHash !== expectedSignalHash.toLowerCase()) {
  throw new Error('Stored signal hash does not match the agent publication signal');
}

const typedData = {
  domain: {
    name: 'LibroAgentRegistry',
    version: '1',
    chainId: ${document.chain_id},
    verifyingContract: registryAddress,
  },
  types: {
    AgentDocument: [
      { name: 'registrationHash', type: 'bytes32' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'documentNonce', type: 'bytes32' },
      { name: 'signedAt', type: 'uint64' },
    ],
  },
  primaryType: 'AgentDocument',
  message: {
    registrationHash,
    documentSignalHash: BigInt(expectedSignalHash),
    documentNonce,
    signedAt,
  },
};

const signer = await recoverTypedDataAddress({ ...typedData, signature });
if (signer.toLowerCase() !== expectedAgent.toLowerCase()) {
  throw new Error('Agent signature was not made by the registered agent');
}

const client = createPublicClient({
  chain: worldchain,
  transport: http('https://worldchain-mainnet.g.alchemy.com/public'),
});

const registered = await client.readContract({
  address: registryAddress,
  abi: libroAgentRegistryAbi,
  functionName: 'verifyAgentDocument',
  args: [BigInt(expectedSignalHash)],
});

if (!registered) {
  throw new Error('Libro agent registry does not contain this document signal');
}

console.log({ registered, signer, signalHash: expectedSignalHash });`

  return {
    code,
    content: `This document shows how to independently verify the Libro proof for <i><u>${escapeHtml(publication.publication_title)}</u></i> by <a href="${process.env.NEXT_PUBLIC_APP_URL}/a/${publication.author_id_libro}">${escapeHtml(publication.author_name_libro)}</a>.
<br/><br/>This is a <strong>human-authorized agent signature</strong>, not a direct human-authorship proof. A human principal registered the agent address with World ID, and the registered agent signed this exact publication signal.
<br/><br/>Agent: <code>${escapeHtml(document.agent_address)}</code>.
<br/>Agent registration: <code>${escapeHtml(registration.registration_hash)}</code>.
<br/>Registry: <code>${escapeHtml(document.registry_address)}</code>.
<br/>Document signal hash: <code>${escapeHtml(document.document_signal_hash)}</code>.
<br/>Document transaction: <code>${escapeHtml(document.transaction_hash)}</code>.
<br/><br/><pre><code class="language-javascript">${codeToHtml(code)}</code></pre>`,
  }
}

export const Proof = ({ publication, proof }: { publication: PublicationType, proof: ProofType }) => {
  const authors: AuthorType[] = [{ id: '0', name: 'Memorioso Team', handle: 'libro' }]
  const title = 'Independent Verification of Human Authorship'
  const document = isLegacyPublication(publication)
    ? buildLegacyUnavailableDocument(publication)
    : isLibroAgentProof(proof)
    ? buildLibroAgentProofDocument(publication, proof)
    : isLibroRegisteredProof(proof)
    ? buildLibroProofDocument(publication, proof)
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
