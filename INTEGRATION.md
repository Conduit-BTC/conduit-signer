# Embedded signer integration handoff

This repository implements the key-owning iframe and its correlated endpoint.
The monorepo's `AuthProvider`, `AccountSigner` and `SessionSigner` remain the
account/lifecycle/operation owners. This PR adds no monorepo runtime integration.

## Source and wire contract

Use `src/embedded.ts` with `src/protocol.ts` as one small endpoint package/module;
do not copy the parent probe, create another transport, or impersonate NIP-07.
The canonical client is `SignerClient`, promoted from PR #1. Wire version
`conduit-signer-proof-1` is retained for compatibility; it is a protocol identifier,
not a product label. No key import/export RPC exists. Import is signer-owned UI.

| Existing operation | App-side mapping                         | Successful result                                                 |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------------- |
| `status`           | connect/restore and public-key discovery | `{frame, binding: {pubkey, revision} \| null}`                    |
| `signEvent`        | `NostrKeySigner.signEvent`               | complete event with independently checked template/hash/signature |
| `encryptNip44`     | `NostrKeySigner.encryptNip44`            | NIP-44 v2 ciphertext                                              |
| `decryptNip44`     | `NostrKeySigner.decryptNip44`            | plaintext                                                         |
| `decryptLegacy`    | existing narrow NIP-04 read method       | plaintext; no NIP-04 sending                                      |
| `logout`           | provider credential cleanup              | `null` only after conditional durable deletion                    |

Failures remain `disconnected`, `unavailable`, `timeout`, `invalid_response`, and
`authority_changed`. Map disconnected to the auth lifecycle's disconnected state;
map the other codes into existing typed signer failures. Do not put payloads in
errors, telemetry, browser traces or logs. Results contain operation data, not
permission to use a stale app principal.

## Embed and restore

1. Create a separate-origin iframe with the exact configured signer URL, a clear
   title, `referrerPolicy="no-referrer"`, and sandbox
   `allow-scripts allow-same-origin allow-forms`. Retain that iframe for the lease.
2. Construct `new EmbeddedSigner(frame, exactSignerOrigin, onChange, timeoutMs)`
   before attaching it. Load automatically sends status. `connect(signal?)` also
   binds an already-loaded frame and coalesces simultaneous handshakes. Cancelling
   any waiter cancels the shared attempt and rejects all waiters; late status
   replies cannot restore it. A pre-aborted signal starts no handshake. After a
   failed or cancelled handshake, the auth owner must start a fresh connection
   attempt after cleanup; it cannot reuse the old lease or channel.
3. `onChange(null)` synchronously revokes app authority and pending operations.
   A later non-null `Status` is a provider observation, never permission to reuse
   a previously revoked app lease. Install a new candidate through the existing
   transactional auth installation owner, with cancellation/attempt-epoch checks.
4. If `status.binding` is null, show the signer-owned import view. After import,
   the endpoint automatically observes the new binding; the app receives only
   public identity/revision. On reload it discovers the stored record without
   passing credentials or requesting routine approval.
5. Persist only the named local method/public metadata needed for restoration.
   The signer revision is a provider generation, distinct from the app authority
   revision. Compare both around awaits. Never persist an NSEC or an independently
   usable unwrapping key in app storage, URLs, IndexedDB, workers or services.

The iframe endpoint enforces exact origin/source and request/channel/frame/account
binding. Frame load, `src` changes, removal, authenticated changes (including
while status is pending), AbortSignal cancellation, close and timeouts invalidate
pending results. App account replacement must synchronously revoke its old lease
and call endpoint `close()` before installing another. Closing cancels a transport;
it does not delete the signer record. That distinction preserves automatic restore.

The transport is one bounded operation at a time. Compose it through the existing
serialized `SessionSigner`, with its exact principal, revision and capability
checks. Do not add an independent app queue, relay transport or account owner.

## Logout and failures

Explicit user logout first revokes app authority synchronously, then calls the
old bound endpoint's `request({method: "logout"})` for provider cleanup, and closes
that endpoint after settlement. Keep a captured binding/endpoint for cleanup;
do not reconnect to a changed account solely to delete it. The signer uses a
conditional revision check so a stale view cannot delete a later import.

Successful logout deletes the current record, clears active key buffers, revokes
same-partition views via BroadcastChannel and durable pre/post-operation checks,
and cancels pending parent requests. Another view must observe absent status.
Separate Safari/PWA/Market/Merchant partitions may need separate logout.

A failed deletion is a failed logout: report it after app authority is revoked.
The failing signer view stays unavailable until successful removal or reimport;
other partitions/records cannot be assumed deleted. Storage unavailable differs
from record absent. Do not silently create an in-memory session, move the key to
the parent, or repeatedly retry cryptographic actions under replaced authority.

## Exact preview configuration

`bun run build:preview` requires all three `PROOF_MARKET_ORIGIN`,
`PROOF_MERCHANT_ORIGIN`, `PROOF_SIGNER_ORIGIN` values explicitly, as exact HTTPS
origins. It emits only `dist/signer`, with exact `frame-ancestors` and signer-side
parent admission. No wildcard, path, userinfo, query or fragment is allowed.
No illustrative or guessed signer hostname is admitted by default.

Before setting them, verify each parent deployment against its source head and
hosting metadata, and verify the signer hosting target. Rebuild when a preview
origin changes; the allowlist and CSP must change together. Deploy only the signer
artifact to its dedicated target and independently verify hosted response headers.
Never upload parent probes onto Market/Merchant or combine surfaces on one origin.
A build is not deployment or hostname approval. Provisioning/deploying remains a
separate authorized action. Missing hosting evidence leaves preview configuration
incomplete rather than falling back to production or wildcard origins.

## Remaining composed evidence

The integration PR should cover installed-only shared UI, external signer and
browsing regressions, same/new-account restore, failed candidate rollback,
account/frame replacement, cross-view revocation, cancellation, and cleanup
failure. Exercise existing Market checkout/orders/messages and Merchant listing,
Network/inbox/order/messaging owners, including protected-read eligibility and
NIP-17/NIP-59. Do not equate this utility's real-crypto tests with those flows.

Physical iPhone evidence is separate: record device/iOS and exact origin triple,
Safari versus installed Market/Merchant partitions, termination/relaunch, frame
reload, warm/cold offline behavior, storage loss and logout/reimport. Desktop
Chromium/WebKit and page reopening do not establish iOS persistence. Production
activation still needs that evidence and maintainer security sign-off.
