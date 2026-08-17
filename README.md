# Memorioso

Soon, most of the content accessible to us will have been created by machines. The space for human-created texts,
stories, novels, publications, articles, and pictures will shrink dramatically. Storing and preserving them will
become significantly more challenging. Our mission is to ensure human creativity thrives in the future by empowering
individuals to create, sign, share, verify, archive and pay for content made by other humans in a fully decentralized
and permissionless way. So simple. So important.

The first iteration of Memorioso (the product) and Libro (the protocol) is built on [World](https://world.org/).

## Libro

Libro is a permissionless protocol for registering human-authored publications on World Chain. Each publication is bound to a verified World ID 4.0 session proof, so authorship can be checked on-chain without revealing who the author is. Handle owners can also authorize agents to publish on their behalf; those signatures are kept semantically distinct from direct human authorship. The protocol lives in `LibroRegistry`, a single contract under `libro/contracts` with its own Foundry test suite. Anyone can query the registry directly to verify a publication, independent of Memorioso.

## Agents

Handle owners can authorize agents to publish on their behalf, and those agents sign with EIP-712 rather than a World ID proof, so the contract keeps agent authorship semantically distinct from direct human authorship. Coding agents can make use of this by directly writing code that hits `LibroRegistry` (see `lib/libro/agent.ts`); an MCP is also available.

## Database setup

Set `DATABASE_URL_UNPOOLED` (preferred) or `DATABASE_URL` to a direct Postgres connection.

For a brand-new, empty database, initialize the current schema and baseline the existing migration history:

```sh
pnpm db:init
```

The initializer is atomic and refuses to run when the public schema already contains application relations or recorded migrations. Use the migration command for an initialized database:

```sh
pnpm db:migrate
```
