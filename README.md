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
- `WORLD_ID_PUBLISH_ACTION_PREFIX=written-by-a-human-v4`
- `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production`
- `NEXT_PUBLIC_LIBRO_CHAIN_ID=480`
- `NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS`
- `NEXT_PUBLIC_LIBRO_AGENT_REGISTRY_ADDRESS`
- `WORLD_ID_AGENT_REGISTRATION_ACTION=register-agent-v1`
- `LIBRO_RELAYER_PRIVATE_KEY` for sponsored publication registration outside World App

Use `.env.example` as the starting point for local configuration.

## Libro on-chain registration

Libro protocol assets live under `libro/` so they can be split into a separate repository later:

- `libro/contracts` contains the Foundry project for `LibroProofRegistry`.
- `libro/skill` contains the Libro protocol skill and reference.

`LibroProofRegistry.register(...)` is permissionless: anyone can submit a valid registration transaction. Direct human publications use per-challenge World ID actions such as `written-by-a-human-v4-<challengeId>`, and the dynamic action hash is passed to the registry with the proof. Deploy the registry with the numeric `rpId` derived from `WORLD_ID_RP_ID` by interpreting the 16 hex characters after `rp_` as `uint64`. Inside World App, the user's World wallet submits through MiniKit. Outside World App, the server submits the same prepared transaction from the funded `LIBRO_RELAYER_PRIVATE_KEY` account and sponsors its gas.

`LibroAgentRegistry` is the companion registry for human-authorized agent documents. A human principal first registers an agent address with World ID action `register-agent-v1`; later the agent signs document payloads with EIP-712 and any wallet or relayer can submit the registration transaction.

Run `forge test` from `libro/contracts` to test the registry contract.

## Libro website embeds

Finalized direct-human publications expose `libro-embed-v1`: a `.libro-human-authored` content wrapper plus an adjacent `application/libro+json` manifest. Publication pages include the declaration and offer a copyable, sanitized embed. The same public manifest is available at `/api/publications/{id}/libro-manifest`.

The Chrome Manifest V3 verifier lives under `libro/chrome-extension`. Build it with `pnpm extension:build`, then load `libro/chrome-extension/dist` as an unpacked extension. It scans only after a toolbar click and checks readable text, canonical hashes, the approved registry, and the registration transaction independently on World Chain.
