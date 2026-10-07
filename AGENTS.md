# Conduit Signer

This MIT-licensed repository owns the embedded existing-NSEC signer utility.
The supported surface owns import, automatic restoration and explicit logout.
Production release, deployment, access changes and real-key validation require
explicit maintainer authority. Test harnesses use runtime-generated identities.

## Boundary

- Keep the dependency graph narrow and locked. The signer alone owns nsec entry,
  parsing, IndexedDB storage, key use and logout. Parents receive only typed
  status/public key, verified signing results, NIP-44 results, legacy NIP-04
  decrypt results and logout status. No raw-key import/export RPC.
- Market/Merchant origins and services must never receive a key, backup or
  material that independently unwraps it. No relay or wallet transport here.
- Validate exact parent/signer origin, source window, request/channel/frame IDs
  and account/revision binding. Keep bounded timeouts and cancellation. Fail
  closed on stale authority, malformed results or unavailable storage.
- Runtime disposable fixtures are approved only in the isolated `proof/fixture.ts` signer-frame
  test control and unit-test process, using `generateSecretKey` from
  `nostr-tools/pure`. No fixed keys, scalars or encoded credentials; no diagnostic,
  export or network sink. Never alias encoding to evade a guard. The fixture
  control is included only with `--harness`, never the supported signer build.
- Keep evidence content-free. No key, identity, plaintext, ciphertext, invoice,
  order/message data, browser trace, video or populated-input screenshot.

## Feasibility and integration

Physical iPhone evidence must cover normal Safari and installed Market/Merchant
at the exact approved origins, including persistence, signing, NIP-44, frame
replacement, termination/relaunch, offline/online and logout/reimport. Record
device/iOS and separate imports. Desktop browsers cannot pass this gate.

For composed preview development, adapt the local provider to the existing
Conduit AccountSigner/SessionSigner owner. Preserve auth authority fencing,
pending-operation cancellation, protected-read eligibility and shared NIP-17/
NIP-59 behavior. The embedded transport is not a new account/session owner. Installed
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

Required browser checks use actual server outages. The separate offline-emulation
diagnostic preserves the known WebKit failure and must remain an honest nonzero
result until resolved. Neither is physical iPhone evidence. See README.md.

Sudden is advisory and runs behind an isolated reviewer boundary. Never add
account credentials, App private keys or auth-refresh workflows to this public
repository. Candidate code must not run with reviewer credentials. Report missing
reviews to a maintainer; do not name private runner repositories or secret
locations in public history. Require human security review for this signer.
