import Editor from '@/components/Editor'
import Link from 'next/link'
import { PublicationRecord as PublicationType, Proof as ProofType, Author } from '@/lib/db/objects'
import { WORLD_ID_CREDENTIAL_LABELS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'

const getCredentialIdentifier = (proof?: ProofType | null) => {
  return proof && 'protocol_version' in proof && proof.protocol_version === '4.0'
    ? proof.credential_identifier
    : null
}

export const Publication = ({ publication, proof, proofLink }: { publication: PublicationType, proof?: ProofType | null, proofLink?: string }) => {

  const authors: Author[] = [{ id: publication.author_id_libro, name: publication.author_name_libro,
                               bio: publication.author_bio_libro, handle: publication.author_handle_libro }]

  const content = 'content' in publication.publication_content 
    ? publication.publication_content.content
    : publication.publication_content.html
  const credentialIdentifier = getCredentialIdentifier(proof)
  const credentialLabel = credentialIdentifier
    ? WORLD_ID_CREDENTIAL_LABELS[credentialIdentifier as WorldIdCredentialIdentifier] || credentialIdentifier
    : null

  return (
    <div className="w-[96%] mx-auto space-y-4 py-4">
      <div className="text-xs text-muted-foreground text-center">
        {credentialLabel && <>Verified with {credentialLabel}. </>}
        Proof of authorship can be {proofLink ? (
          <Link href={proofLink} className="underline hover:text-primary">
            verified
          </Link>
        ) : (
          'verified'
        )} independently.
      </div>
        <Editor authors={authors}
              initialContent={content}
              initialTitle={publication.publication_title}
              initialSubtitle={publication.publication_subtitle}
              initialAuthorId={publication.author_id_libro}
              publicationDate={publication.publication_date}
              editable={false}
              />
    </div>
  );
}
