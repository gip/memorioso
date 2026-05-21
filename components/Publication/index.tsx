import Editor from '@/components/Editor'
import Link from 'next/link'
import { PublicationRecord as PublicationType, Proof as ProofType, Author } from '@/lib/db/objects'
import { WORLD_ID_CREDENTIAL_LABELS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'
import {
  getCredentialIdentifierForPublication,
  isLegacyPublication,
  LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE,
} from '@/lib/publication-status'

export const Publication = ({ publication, proof, proofLink }: { publication: PublicationType, proof?: ProofType | null, proofLink?: string }) => {

  const authors: Author[] = [{ id: publication.author_id_libro, name: publication.author_name_libro,
                               bio: publication.author_bio_libro, handle: publication.author_handle_libro }]

  const content = publication.publication_content.html
  const isLegacy = isLegacyPublication(publication)
  const credentialIdentifier = getCredentialIdentifierForPublication(publication, proof)
  const credentialLabel = credentialIdentifier
    ? WORLD_ID_CREDENTIAL_LABELS[credentialIdentifier as WorldIdCredentialIdentifier] || credentialIdentifier
    : null

  return (
    <div className="w-[96%] mx-auto space-y-4 py-4">
      {isLegacy && (
        <div className="mx-auto max-w-3xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE}
        </div>
      )}
      <div className="text-xs text-muted-foreground text-center">
        {credentialLabel && <>Verified with {credentialLabel}. </>}
        {isLegacy ? (
          'Independent verification is not available for this legacy publication.'
        ) : <>Proof of authorship can be {proofLink ? (
          <Link href={proofLink} className="underline hover:text-primary">
            verified
          </Link>
        ) : (
          'verified'
        )} independently.</>}
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
