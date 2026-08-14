type PublicationNotFoundProps = {
  kind: 'article' | 'short'
}

export const PublicationNotFound = ({ kind }: PublicationNotFoundProps) => (
  <main className="flex flex-1 items-center justify-center px-4 py-20 text-center sm:py-28">
    <div className="max-w-xl">
      <h1 className="spectral text-pretty text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
        This {kind} can’t be found on Memorioso.
      </h1>
      <p className="mx-auto mt-5 max-w-lg text-pretty text-[17px] leading-relaxed text-muted-foreground">
        It may still exist somewhere else. Memorioso does not hold every signed document.
      </p>
    </div>
  </main>
)
