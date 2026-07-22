# Libro Chrome Extension

Set the Memorioso origin used by the extension build (the default is production):

```sh
cp libro/chrome-extension/.env.example libro/chrome-extension/.env.local
```

`VITE_MEMORIOSO_APP_URL` is compiled into the service worker and its exact origin is written to the
generated manifest host permissions.

Build the unpacked Manifest V3 extension from the repository root:

```sh
pnpm extension:build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select
`libro/chrome-extension/dist`.

The extension requests temporary access only after its toolbar icon or **Sign with Libro** context
menu is clicked. It scans the active
top-level page for `.libro-human-authored` blocks and delimited plain-text Libro tags. It independently
checks their manifest, readable text, canonical signal hash, approved registry, and registration
transaction on World Chain. Plain-text tags resolve their public manifest through the URL in the
opening boundary; a legacy tag without a resolvable manifest is detected but not marked verified.

## Inline signing

Choose **Sign current text** in the popup or **Sign with Libro** from an editor's context menu. The
side panel captures the current selection, then the whole focused `textarea` or `contenteditable`,
and otherwise offers manual entry. Connect an existing Memorioso handle with World ID, review the
normalized public text, and complete the publication proof. Memorioso sponsors the World Chain
registration. The extension replaces an unchanged supported editor target with the portable Libro
tag; if the page changed or the source is unsupported, it copies the tag instead.

The bearer credential is stored only in `chrome.storage.local` and used only by the extension service
worker. Proof-complete publish identifiers are persisted so relay and finalization can be resumed.
Apply `lib/db/migrations/006_libro_extension_signing.sql` before using inline signing against an
existing database.

The green state covers readable DOM text only. It does not authenticate styling, links, images,
CSS-generated content, or a legal identity behind the signed author name.
