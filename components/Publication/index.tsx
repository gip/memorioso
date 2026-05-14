import Editor from '@/components/Editor'
import Link from 'next/link'
import { PublicationRecord as PublicationType, Author } from '@/lib/db/objects'
import { WORLD_ID_CREDENTIAL_LABELS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'

export const Publication = ({ publication, proofLink }: { publication: PublicationType, proofLink?: string }) => {

  const authors: Author[] = [{ id: publication.author_id_libro, name: publication.author_name_libro,
                               bio: publication.author_bio_libro, handle: publication.author_handle_libro }]

  const content = 'content' in publication.publication_content 
    ? publication.publication_content.content
    : publication.publication_content.html
  const credentialLabel = publication.world_id_credential_identifier
    ? WORLD_ID_CREDENTIAL_LABELS[publication.world_id_credential_identifier as WorldIdCredentialIdentifier] || publication.world_id_credential_identifier
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
