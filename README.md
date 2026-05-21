# Memorioso

Soon, most of the content accessible to us will have been created by machines. The space for human-created texts,
stories, novels, publications, articles, and pictures will shrink dramatically. Storing and preserving them will
become significantly more challenging. Our mission is to ensure human creativity thrives in the future by empowering
individuals to create, sign, share, verify, archive and pay for content made by other humans in a fully decentralized
and permissionless way. So simple. So important.

The first iteration of Memorioso (the product) and Libro (the protocol) is built on [World](https://world.org/), the real human network.

*Memorioso is currently in the [Make It Work](https://www.perplexity.ai/search/what-the-make-it-work-stage-wh-2iYhHhS4T9CCGkfezjDqwA) stage.*

## World ID 4.0 configuration

Memorioso uses IDKit 4.x for both login session proofs and publication proofs. Required environment variables:

- `SESSION_SECRET`
- `NEXT_PUBLIC_WORLD_ID_APP_ID`
- `WORLD_ID_RP_ID`
- `WORLD_ID_RP_SIGNING_KEY`
- `WORLD_ID_PUBLISH_ACTION=written-by-a-human-v4`
- `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production`
- `NEXT_PUBLIC_LIBRO_CHAIN_ID=480`
- `NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS`
- `LIBRO_WORLD_ID_VERIFIER_ADDRESS`
- `LIBRO_WORLD_ID_RP_ID_UINT64`

Use `.env.example` as the starting point for local configuration.

## Libro on-chain registration

Libro protocol assets live under `libro/` so they can be split into a separate repository later:

- `libro/contracts` contains the Foundry project for `LibroProofRegistry`.
- `libro/skill` contains the Libro protocol skill and reference.

`LibroProofRegistry.register(...)` is permissionless: anyone can submit a valid registration transaction. Memorioso uses MiniKit for World App gas sponsorship, not because the contract requires MiniKit.

Run `forge test` from `libro/contracts` to test the registry contract.
