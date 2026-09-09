# Mobile World ID return and recovery

External mobile browsers use `/world-id/return?flow=<random UUID>` before opening
World App. The initiating screen saves the original IDKit bridge connector and
operation on the same browser origin before navigating to that page, which
shows **Open World App**. IDKit receives that
page's absolute HTTPS URL as `return_to`. HTTP local development omits it.

The URL contains only a lookup ID, never the bridge encryption key or a proof.
The callback is navigation, not authentication. The page polls the original
bridge response, decrypts it locally, decodes it with IDKit, and submits it to
the same server verification endpoints as the existing widgets. It never uses
callback query parameters as evidence of success. Reloads and fresh tabs on the
same browser origin recover through localStorage. Cross-tab Web Locks serialize
polling and completion. Focus, pageshow and visibility changes trigger checks.

Login, Libro identity, publication signing, handle claims, agent authorization,
and legacy draft publishing use this flow. Desktop, World App's native transport,
and browsers without secure storage, Web Locks, or modern AbortSignal support
keep the standard SDK widget. Backgrounding aborts bridge reads to release their
cross-tab lock before the browser can suspend the page.
Legacy agent registration still requires the native World wallet and keeps that
widget as well. Mobile web submits prepared operations through the existing
relayers. It does not introduce a new server verifier or bypass cutover guards.

Pending bridge records expire at the earlier of five minutes and RP expiry.
Prepared registrations have a 24-hour local recovery window; the server still
enforces its own validity rules. Prepare and transaction hashes are checkpointed
before continuing, so a retry resumes finalization without another proof or
broadcast when the hash is known. Completion removes proof and bridge secrets,
leaving a five-minute receipt for duplicate callbacks. Expired records are
pruned on access/start, canceled unprepared requests are removed, and sign-out
clears the flow store. Records contain signal hashes, not the original signals
(which can include titles/subtitles), draft prose, or draft encryption keys.

## Pinned SDK patch

The application directly depends on `@worldcoin/idkit-core@4.2.4`. The override
for `@worldcoin/idkit@4.2.2` also selects core 4.2.4, avoiding two core versions
inside the app. The extension's separate dependency is unchanged.

IDKit has no public restore API in this version. The patch in
`patches/@worldcoin__idkit-core@4.2.4.patch` exports a small session bridge decoder
around the existing WASM `proofResponseToIDKitResult`. It retains IDKit's proof
encoding and session-nullifier conversion instead of implementing a second
parser. It is not a cryptographic proof verifier. Remove the patch when an
upstream restore API can replace it. The bridge regression test runs the actual
installed WASM, creates an SDK request, checks its HTTPS `return_to_url`, and
decrypts/decodes a synthetic encrypted response after serialization.

## Real-device acceptance test

SDK tests confirm HTTPS is carried in the request; they do not establish that
World App opens it. Test a staging deployment on iOS Safari and Android Chrome,
recording browser, OS and World App versions:

1. Start login, open World App, approve, and observe whether it returns
   automatically. If it does not, use the back-chip or switch to the browser.
2. Repeat with the browser page reloaded or evicted while World App is open.
   The same request must finish without generating a second proof.
3. Open the callback in a second tab of the same browser. Only one completion
   should run; both tabs should observe success.
4. Repeat publication signing, handle claim and agent authorization. Interrupt
   the connection after preparation/broadcast and use **Resume verification**.
5. Reject a proof, let an unprepared request expire, and try a callback in another
   browser/private window. None must imply authentication. A different browser
   has neither the saved state nor necessarily the original cookies; return to
   the initiating browser instead.

Keep the polling and back-chip instructions even if all tested versions open
the callback successfully. No custom native URL scheme is needed for this web
callback.
