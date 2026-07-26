# Libro Chrome Extension

The production build uses `https://www.memorioso.xyz`:

```sh
pnpm extension:build
```

The stage build uses `https://worldlibro.vercel.app` and writes a separate unpacked extension:

```sh
pnpm extension:build:stage
```

Load `libro/chrome-extension/dist-stage` in `chrome://extensions`. Chrome labels this build
**Libro Verifier (Stage)** so it can be distinguished from the production build.

To override the Memorioso origin for either mode, create a local environment file:

```sh
cp libro/chrome-extension/.env.example libro/chrome-extension/.env.local
```

The override is compiled into the service worker and its exact origin is written to the generated
manifest host permissions. Local environment files are not committed.

Build the unpacked production Manifest V3 extension from the repository root:

```sh
pnpm extension:build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select
`libro/chrome-extension/dist`.

The extension requests temporary access only after its toolbar icon or **Sign with Libro** context
menu is clicked. It scans the active
top-level page for `.libro-human-signed` blocks and delimited plain-text Libro tags. It independently
checks their manifest, readable text, canonical signal hash, approved registry, and registration
transaction on World Chain. Plain-text tags resolve their public manifest through the URL in the
opening boundary; a legacy tag without a resolvable manifest is detected but not marked verified.

## Inline signing

Choose **Sign current text** in the popup or **Sign with Libro** from an editor's context menu. The
side panel captures the current selection, then the whole focused `textarea` or `contenteditable`,
and otherwise offers manual entry. Capture reaches editors inside open shadow roots, reads the
selection offsets a field keeps after it loses focus to the panel, and falls back to the selection
Chrome reports with the context menu click. Editors inside an iframe are not captured.

While the panel is reviewing text, later edits of the captured editor flow back into it: a capture
that covered the whole field follows every edit, and a captured selection stays anchored to its
region as the surrounding text changes. Typing in the panel takes over and stops the sync, and the
text freezes for good once the signing request binds it to a World ID challenge. Connect an existing Memorioso handle or create a first author
with a public name and optional bio, verify with World ID, review the normalized public text, and
complete the publication proof. Memorioso sponsors the World Chain registration. The extension
replaces an unchanged supported editor target with the portable Libro tag; if the page changed or
the source is unsupported, it copies the tag instead.

The bearer credential is stored only in `chrome.storage.local` and used only by the extension service
worker. Proof-complete publish identifiers are persisted so relay and finalization can be resumed.
Apply the database migrations through `007_libro_extension_signup.sql` before using inline signing
against an existing database.

The green state covers readable DOM text only. It does not authenticate styling, links, images,
CSS-generated content, or a legal identity behind the signed author name.
