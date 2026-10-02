# Conduit Signer

This MIT-licensed repository owns a disposable-key, separate-origin feasibility
prototype. It is not released for real account keys. Do not merge, deploy,
release, change access or use real keys without explicit maintainer authority.

## Boundary

- Keep the dependency graph narrow and locked. The signer alone owns nsec entry,
  parsing, IndexedDB storage, key use and logout. Parents receive only typed
  status/public key, verified signing results, NIP-44 results, legacy NIP-04
  decrypt results and logout status. No raw-key import/export RPC.
- Market/Merchant origins and services must never receive a key, backup or
  material that independently unwraps it. No relay or wallet access in the proof.
- Validate exact parent/signer origin, source window, request/channel/frame IDs
  and account/revision binding. Keep bounded timeouts and cancellation. Fail
  closed on stale authority, malformed results or unavailable storage.
- Runtime disposable fixtures are approved only in the isolated signer-frame
  test control and unit-test process, using `generateSecretKey` from
  `nostr-tools/pure`. No fixed keys, scalars or encoded credentials; no diagnostic,
  export or network sink. Never alias encoding to evade a guard. The fixture
  control is development equipment and must be removed from production UI.
- Keep evidence content-free. No key, identity, plaintext, ciphertext, invoice,
  order/message data, browser trace, video or populated-input screenshot.

## Feasibility and integration

Physical iPhone evidence must cover normal Safari and installed Market/Merchant
at the exact approved origins, including persistence, signing, NIP-44, frame
replacement, termination/relaunch, offline/online and logout/reimport. Record
device/iOS and separate imports. Desktop browsers cannot pass this gate.

After feasibility and security review, adapt the local provider to the existing
Conduit AccountSigner/SessionSigner owner. Preserve auth authority fencing,
pending-operation cancellation, protected-read eligibility and shared NIP-17/
NIP-59 behavior. The proof client is not a new production session owner. Installed
mode is a UX gate. Existing-key import and automatic restoration are the scope;
account creation, unlock ceremonies, onboarding, wallet rollout and settings
sync are separate work. No routine per-action approval or at-rest security claim.

## Validation

Read README.md and SECURITY.md before changes. Check current public NIP-01,
NIP-07, NIP-44, NIP-17, NIP-59 and NIP-04 sources before protocol changes.
Public NIP-44 is v2; future v3 needs public references and capability detection.
Run `bun test`, typecheck, lint, formatting, static build and the relevant
Playwright checks. Preserve failing device/emulator evidence honestly. No retries
or assertion weakening to manufacture a pass. Use conventional commits and the
PR template; keep private tracker context out of public history.
