import type { ReactNode } from 'react'
import Link from 'next/link'
import { MemMark } from '@/components/MemMark'
import { PublicationTimestamp } from '@/components/PublicationTimestamp'
import { Proof as ProofType, PublicationRecord as PublicationType } from '@/lib/db/objects'
import { extractReadableText, LIBRO_WORLD_CHAIN_RPC_URLS } from '@libro/core'
import { WORLD_ID_CREDENTIAL_LABELS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'
import {
  isLegacyPublication,
  isLibroAgentProof,
  isLibroRegisteredProof,
  isWorldIdV4Proof,
  LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE,
} from '@/lib/publication-status'
import { CodeCard } from './CodeCard'
import { CopyValue } from './CopyValue'
import { publicationPathFor } from '@/lib/publication-kind'

const WORLD_CHAIN_ID = 480
const WORLD_CHAIN_EXPLORER = 'https://worldscan.org'

type Fact = {
  label: string
  value: string
  href?: string
  copy?: boolean
}

type ProofView = {
  eyebrow: string
  headline: string
  summary: ReactNode
  facts: Fact[]
  code?: string
  codeNote?: string
}

const shorten = (value: string) =>
  value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value

const explorerLink = (chainId: number, kind: 'tx' | 'address', value: string) =>
  chainId === WORLD_CHAIN_ID ? `${WORLD_CHAIN_EXPLORER}/${kind}/${value}` : undefined

const credentialLabelFor = (identifier: string) =>
  WORLD_ID_CREDENTIAL_LABELS[identifier as WorldIdCredentialIdentifier] || identifier

const signalJsonDeclaration = (signalText: string) => `const signalJson = ${JSON.stringify(JSON.parse(signalText), null, 2)};
const signalText = JSON.stringify(signalJson);`

const authorHref = (publication: PublicationType) =>
  `/@${publication.author_handle_libro}`

const AuthorLink = ({ publication }: { publication: PublicationType }) => (
  <Link href={authorHref(publication)} className="font-medium text-blurple hover:underline">
    {publication.author_name_libro}
  </Link>
)

function buildUnavailableView(publication: PublicationType): ProofView {
  return {
    eyebrow: 'Proof',
    headline: 'Verification unavailable',
    summary: (
      <>
        {LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE} The text by <AuthorLink publication={publication} /> stays
        published and readable.
      </>
    ),
    facts: [],
  }
}

function buildWorldIdView(
  publication: PublicationType,
  proof: Extract<ProofType, { protocol_version: '4.0' }>
): ProofView {
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
    eyebrow: 'Proof',
    headline: 'Signed by a human',
    summary: (
      <>
        <AuthorLink publication={publication} /> proved humanity with World ID and signed this exact text. The
        proof predates Libro on-chain registration, so it is checked against World&rsquo;s verifier rather than a
        registry contract.
      </>
    ),
    facts: [
      { label: 'Credential', value: credentialLabelFor(proof.credential_identifier) },
      { label: 'Signal hash', value: proof.signal_hash, copy: true },
    ],
    code,
    codeNote:
      'Recomputes the signal hash from the signed publication JSON, checks every World ID response is bound to it, then asks World’s verifier.',
  }
}

function buildLibroView(
  publication: PublicationType,
  proof: Extract<ProofType, { protocol_version: '4.0' }> & {
    libro_registration: NonNullable<Extract<ProofType, { protocol_version: '4.0' }>['libro_registration']>
  }
): ProofView {
  const registration = proof.libro_registration
  const code = `const { createPublicClient, fallback, http } = require('viem');
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
  transport: fallback([
${LIBRO_WORLD_CHAIN_RPC_URLS.map((url) => `    http(${JSON.stringify(url)}),`).join('\n')}
  ]),
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
    eyebrow: 'Proof',
    headline: 'Signed by a human',
    summary: (
      <>
        <AuthorLink publication={publication} /> proved humanity with World ID and signed this exact text. The
        signature is registered on World Chain, so anyone can check it without trusting Memorioso.
      </>
    ),
    facts: [
      { label: 'Credential', value: `World ID ${credentialLabelFor(proof.credential_identifier)}` },
      { label: 'Signal hash', value: registration.signal_hash, copy: true },
      {
        label: 'Registry',
        value: registration.registry_address,
        href: explorerLink(registration.chain_id, 'address', registration.registry_address),
        copy: true,
      },
      {
        label: 'Transaction',
        value: registration.transaction_hash,
        href: explorerLink(registration.chain_id, 'tx', registration.transaction_hash),
        copy: true,
      },
    ],
    code,
    codeNote:
      'Recomputes the signal hash from the signed publication JSON, then asks the registry contract on World Chain whether that hash is registered.',
  }
}

function buildAgentView(
  publication: PublicationType,
  proof: Extract<ProofType, { proof_type: 'human_authorized_agent_signature' }>
): ProofView {
  const registration = proof.agent_registration
  const document = proof.agent_document_signature
  const code = `const { createPublicClient, fallback, http, recoverTypedDataAddress } = require('viem');
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
  transport: fallback([
${LIBRO_WORLD_CHAIN_RPC_URLS.map((url) => `    http(${JSON.stringify(url)}),`).join('\n')}
  ]),
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
    eyebrow: 'Proof',
    headline: 'Human-authorized agent',
    summary: (
      <>
        This is not a direct claim of human authorship. A human proved humanity with World ID and registered the
        agent below, and that agent signed this exact text on behalf of <AuthorLink publication={publication} />.
      </>
    ),
    facts: [
      {
        label: 'Agent',
        value: document.agent_address,
        href: explorerLink(document.chain_id, 'address', document.agent_address),
        copy: true,
      },
      { label: 'Signal hash', value: document.document_signal_hash, copy: true },
      {
        label: 'Registry',
        value: document.registry_address,
        href: explorerLink(document.chain_id, 'address', document.registry_address),
        copy: true,
      },
      {
        label: 'Transaction',
        value: document.transaction_hash,
        href: explorerLink(document.chain_id, 'tx', document.transaction_hash),
        copy: true,
      },
    ],
    code,
    codeNote:
      'Recovers the agent address from the EIP-712 signature, then asks the agent registry on World Chain whether this document signal is registered.',
  }
}

const FactRow = ({ fact }: { fact: Fact }) => {
  const display = shorten(fact.value)

  return (
    <div className="flex items-baseline gap-4 py-2.5">
      <dt className="w-28 shrink-0 text-[13px] text-muted-foreground">{fact.label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-[13.5px] text-foreground">
        {fact.href ? (
          <a
            href={fact.href}
            target="_blank"
            rel="noreferrer"
            title={fact.value}
            className="truncate font-mono text-blurple hover:underline"
          >
            {display}
          </a>
        ) : (
          <span className={fact.copy ? 'truncate font-mono' : 'truncate'} title={fact.value}>
            {display}
          </span>
        )}
        {fact.copy && <CopyValue value={fact.value} label={fact.label} />}
      </dd>
    </div>
  )
}

export const Proof = ({
  publication,
  proof,
  publicationId,
}: {
  publication: PublicationType
  proof: ProofType | null
  publicationId: string
}) => {
  const view = isLegacyPublication(publication)
    ? buildUnavailableView(publication)
    : isLibroAgentProof(proof)
    ? buildAgentView(publication, proof)
    : isLibroRegisteredProof(proof)
    ? buildLibroView(publication, proof)
    : isWorldIdV4Proof(proof)
    ? buildWorldIdView(publication, proof)
    : buildUnavailableView(publication)

  const publicationTitle = publication.publication_title.trim()
  const title = publicationTitle || extractReadableText(publication.publication_content.html)
  const publicationHref = publicationPathFor(publication, publicationId)

  return (
    <article className="pb-16 pt-8">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-blurple">
        <MemMark size={16} />
        {view.eyebrow}
      </div>

      <h1 className="spectral mt-3 text-[clamp(28px,5.5vw,36px)] font-semibold leading-[1.15] tracking-tight text-foreground">
        {view.headline}
      </h1>

      <p className="mt-3 text-[15.5px] leading-[1.6] text-muted-foreground">{view.summary}</p>

      <div className="mt-7 border-t border-zinc-100 pt-1">
        <dl className="divide-y divide-zinc-100">
          <div className="flex items-baseline gap-4 py-2.5">
            <dt className="w-28 shrink-0 text-[13px] text-muted-foreground">Publication</dt>
            <dd className="min-w-0 text-[13.5px]">
              <Link
                href={publicationHref}
                className={`line-clamp-2 font-normal text-blurple hover:underline ${publicationTitle ? '' : 'text-xs'}`}
              >
                {title}
              </Link>
            </dd>
          </div>
          <div className="flex items-baseline gap-4 py-2.5">
            <dt className="w-28 shrink-0 text-[13px] text-muted-foreground">Signed</dt>
            <dd className="min-w-0 text-[13.5px] text-foreground">
              <PublicationTimestamp date={publication.publication_date} />
            </dd>
          </div>
          {view.facts.map((fact) => (
            <FactRow key={fact.label} fact={fact} />
          ))}
        </dl>
      </div>

      {view.code && (
        <section className="mt-9">
          <h2 className="spectral text-[20px] font-semibold tracking-tight text-foreground">Check it yourself</h2>
          {view.codeNote && (
            <p className="mt-2 text-[14.5px] leading-[1.6] text-muted-foreground">{view.codeNote}</p>
          )}
          <CodeCard code={view.code} filename={`verify-${publicationId}.js`} />
        </section>
      )}

      <div className="mt-10 flex justify-center">
        <Link href={publicationHref} className="text-[13px] text-muted-foreground hover:text-blurple">
          Back to the publication
        </Link>
      </div>
    </article>
  )
}
