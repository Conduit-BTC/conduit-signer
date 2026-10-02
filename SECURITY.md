# Security review and release gates

**Status: disposable prototype; policy exception approved, production security
sign-off and physical-iPhone feasibility pending.** Use disposable keys only.
Automatic restoration is not an independent unlock or at-rest protection claim.

## Existing owners and proposed boundary

`conduit-mono/packages/core/src/protocol/nostr-event-signer.ts` defines `AccountSigner` and
`NostrKeySigner`. `conduit-mono/packages/core/src/protocol/session-signer.ts` owns principal/revision fencing, serialized
operations, signed-event validation, timeout and cancellation. `conduit-mono/packages/core/src/context/AuthContext.tsx`
owns account lifecycle; `conduit-mono/packages/ui/src/components/SignerSwitch.tsx` owns shared connection UX. A future
provider must adapt to these owners. It must not impersonate NIP-07/NIP-46, add a
second account owner, or replace publication/public-read/protected-read owners.

This repository owns the standalone proof and eventual separately reviewed signer.
No HTTPS origin, deployment, release or real-key use is approved. The parent
surfaces are probes, not the actual Market/Merchant applications.

The signer alone owns existing-nsec import, persistent key storage, key operations
and logout. The parent receives status/public key, a complete verified signed
event, NIP-44 operation results, narrow legacy NIP-04 decrypt results and logout
status. Import/export, backup retrieval, key generation and NIP-04 sending are
absent from the message API. The proof's disposable fixture button is testing
equipment, not a product creation feature.

## Threats and required controls

| Boundary / attacker                                   | Impact                                         | Current proof control                                                                                                                                                         | Production decision or residual risk                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unapproved parent or sibling frame sends requests     | Unauthorized signing/decryption                | Exact origin allowlist, direct parent/source checks, exact frame-ancestors; parent checks signer origin and current WindowProxy                                               | Freeze and review each deployment/preview origin; no wildcard preview admission                                                                   |
| Stale response, old frame, replay or account switch   | Result committed under wrong authority         | Random channel/request/frame identifiers, stored-record revision and public-key binding, bounded requests, verified exact template/signature, timeout and reload cancellation | Integrate with existing SessionSigner and auth authority; prove composed tab/account transitions                                                  |
| Another view logs out or reimports                    | Old key operation survives revocation          | Per-operation storage read and post-operation revision check; conditional logout deletion; BroadcastChannel invalidation; parent pending-operation cancellation               | Verify partition-specific behavior physically; suspension can delay notifications, so durable checks must remain authoritative                    |
| Compromised Market/Merchant script                    | Allowed signing/decryption oracle; UI spoofing | Same-origin policy isolates raw key storage and frame DOM                                                                                                                     | High residual risk: origin isolation does not stop allowed RPC misuse. No routine action approval means this tradeoff needs maintainer acceptance |
| Compromised signer script, dependency or release      | Account key theft                              | Small static bundle, locked crypto dependency, no app scripts/analytics, restrictive CSP                                                                                      | High residual risk: signer-origin code can read keys. Separate repository/release access and reviewed dependency graph required                   |
| Local device/browser data access                      | Persistent key disclosure                      | Explicit disposable-only experiment; no false wrapping-key claim                                                                                                              | High impact; automatic restore provides no independent unlock protection. Maintainer must accept and document the device-local threat model       |
| WebKit partitioning, eviction or offline load failure | Repeated import or unavailable signer          | Explicit absent/unavailable status, signer-owned reimport, static-only offline cache                                                                                          | Physical device matrix decides feasibility. Never move key/unwrapping capability into app storage                                                 |
| Diagnostics or test artifacts disclose data           | Key/message disclosure                         | Content-free UI/errors, no telemetry, no payload logs, no browser traces/video; server accepts only fixed GET/HEAD asset routes                                               | Review hosted logging, CSP reporting, crash tooling and release artifacts before deployment; screenshots must exclude input and payloads          |

Origin/session checks and signature validation are security/data-integrity
invariants and fail closed. Installed mode is a UX gate; it does not grant key
authority. Storage availability is a capability observation. Missing capability
must preserve browsing and external signers.

Byte-array clearing is best effort; JavaScript strings, browser copies, swap and
backups prevent forensic-erasure guarantees. Encrypting a local record with an
automatically available wrapping key does not protect it from compromised
same-origin code. Logout removes the active stored record and revokes that
storage partition; it cannot promise deletion in a separately isolated PWA.

## Evidence and open decisions

Review `proof/signer.ts` for import, parent source/origin checks and revocation;
`proof/vault.ts` for device-local storage, revision checks and conditional logout;
`proof/protocol.ts` for bounded correlation and exact event verification;
`proof/host.ts` for frame replacement; and `proof/server.ts` for exact origins,
CSP and static-only offline caching. Unit and browser tests exercise these
controls with runtime synthetic identities. There is no production session
provider, account authority, relay transport, analytics or wallet owner here.

High-impact residual threats remain: compromised allowed parent code can request
allowed operations and spoof UI; compromised signer code/release can read the
key; local browser/device access can disclose automatically restored keys.
Maintainers must accept these limits before real-key use. The approved credential
exception does not itself constitute that review.

Exact HTTPS parent/signer origins, hosting/header/logging behavior, release access,
physical storage partitions and persistence remain unknown. These are gates, not
assumed controls. Follow the README device matrix, preserve failure evidence, and
never recover feasibility by moving key or unwrapping capability to a parent.
NIP-44 v2 is current; future v3 remains gated on public references and capability
support. NIP-04 is decrypt-only.

Public protocol sources:
[NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md),
[NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md),
[NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md),
[NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md),
[NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md),
[NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md).
