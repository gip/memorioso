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

## World Chain endpoints

Registration is checked against every enabled endpoint in parallel, and the popup names the ones
that confirmed each block. One endpoint producing the registration event is enough; endpoints that
prune old transactions cannot confirm older publications on their own, which is why more than one
is queried.

Open **World Chain endpoints** in the popup (or the extension's options page) to disable a built-in
endpoint or add your own. Added endpoints must be `https`, and Chrome asks for permission to contact
the host when you add one.

## Inline signing

Choose **Sign current text** in the popup or **Sign with Libro** from an editor's context menu. The
side panel captures the current selection, then the whole focused `textarea` or `contenteditable`,
and otherwise offers manual entry. Capture reaches editors inside open shadow roots, reads the
selection offsets a field keeps after it loses focus to the panel, and falls back to the selection
Chrome reports with the context menu click. Editors inside an iframe are not captured.

**Follow this page automatically** is on by default and is the only thing that lets the page reach
the panel after the first capture. While it is on, the panel tracks the page: focus a different
editor or make a new selection and it re-captures, and later edits of the editor it already holds
flow back into it — a capture that covered the whole field follows every edit, and a captured
selection stays anchored to its region as the surrounding text changes. Typing inside that editor
is an edit, not a move, so the anchoring survives it. An edit in the panel pauses following instead
of being overwritten; **Resume following** re-syncs to the page. The text freezes for good once the
signing request binds it to a World ID challenge.

Turning following off makes the capture a snapshot that nothing on the page changes until you
capture again. That choice is remembered, but following itself is not: it is armed for one tab and
one open panel, riding the same temporary access grant as a manual capture, so the panel re-arms it
each time it opens and it ends when that tab navigates or closes, or when the panel is closed. The
panel says which of those happened and the capture button re-arms it.

Connect an existing Memorioso handle or create a first author with a public name and optional bio,
verify with World ID, review the normalized public text, and complete the publication proof.
Memorioso sponsors the World Chain registration. The extension replaces an unchanged supported
editor target with the portable Libro tag; if the page changed or the source is unsupported, it
copies the tag instead.

The bearer credential is stored only in `chrome.storage.local` and used only by the extension service
worker. Proof-complete publish identifiers are persisted so relay and finalization can be resumed.
Apply the database migrations through `007_libro_extension_signup.sql` before using inline signing
against an existing database.

The green state covers readable DOM text only. It does not authenticate styling, links, images,
CSS-generated content, or a legal identity behind the signed author name.
