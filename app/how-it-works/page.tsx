const libroRegistryAddress = process.env.NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS
const libroRegistryExplorerUrl = libroRegistryAddress
  ? `https://worldscan.org/address/${libroRegistryAddress}`
  : null

const Page = () => (
  <main className="py-6 sm:py-10 lg:py-12">
    <div className="max-w-xl">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-blurple">
        How it works
      </p>
      <h1 className="spectral mt-2 text-3xl font-semibold leading-tight sm:text-4xl">
        Human writing, independently verifiable.
      </h1>

      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-muted-foreground sm:mt-5 sm:text-base">
        <p>
          Write a short or article, then sign it with World ID. Memorioso binds the proof to the
          exact publication and registers it on World Chain, so anyone can verify its human
          authorship without learning the writer&apos;s identity.
        </p>
        <p>
          Memorioso is built on Libro, an open protocol for portable authorship proofs. The Libro
          record remains independently verifiable even when a publication is copied or shared
          somewhere else.
        </p>
      </div>

      <section className="mt-5 rounded-xl border bg-muted/30 p-3.5 sm:mt-7 sm:p-4" aria-label="Libro contract">
        <p className="text-xs font-medium text-foreground">LibroProofRegistry · World Chain</p>
        {libroRegistryExplorerUrl ? (
          <a
            href={libroRegistryExplorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 block break-all font-mono text-[11px] leading-relaxed text-muted-foreground underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-blurple sm:text-xs"
          >
            {libroRegistryAddress}
          </a>
        ) : (
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground sm:text-xs">
            Contract address unavailable
          </p>
        )}
      </section>
    </div>
  </main>
)

export default Page
