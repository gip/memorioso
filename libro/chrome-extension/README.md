# Libro Verifier Chrome Extension

Build the unpacked Manifest V3 extension from the repository root:

```sh
pnpm extension:build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select
`libro/chrome-extension/dist`.

The extension requests temporary access only after its toolbar icon is clicked. It scans the active
top-level page for `.libro-human-authored` blocks and delimited plain-text Libro tags. It independently
checks their manifest, readable text, canonical signal hash, approved registry, and registration
transaction on World Chain. Plain-text tags resolve their public manifest through the URL in the
opening boundary; a legacy tag without a resolvable manifest is detected but not marked verified.

The green state covers readable DOM text only. It does not authenticate styling, links, images,
CSS-generated content, or a legal identity behind the signed author name.
