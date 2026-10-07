# Conduit Signer

MIT-licensed separate-origin Nostr signer feasibility prototype.

This is a **development experiment**, not a production signer or an enabled
Market/Merchant authentication method. Use disposable keys only. It has no relay
or wallet access. It does not change `AccountSigner`, `SessionSigner`, the auth
provider, protected reads, or shared connection UI. This repository owns the
standalone proof. Production use requires an approved origin, physical-device
feasibility evidence and maintainer security review.

The two parent surfaces are minimal installed-app storage probes. They are not
the composed Market/Merchant applications. Their passing results cannot satisfy
app integration acceptance or substitute for a physical iPhone check at the exact
approved intended origins.

## Run locally

From this repository root, using its locked dependencies:

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:7030` for the Market probe and
`http://localhost:7031` for Merchant. The embedded signer is
`http://localhost:7032`. The server binds loopback only. Stop it with Ctrl-C.

1. In the signer frame, select **Prepare disposable import**. This generates a
   runtime test fixture only, fills the password field, and does not print or
   export it. This control must never become product key-creation UI.
2. Confirm disposable use and select **Import test key**. The input clears before
   the asynchronous storage write. Alternatively, enter an independently prepared
   disposable nsec directly in that frame. Never enter a real account key.
3. Select **Check status**, **Verify signing**, and **Verify NIP-44** in the parent.
   Results contain pass/fail text, never identities or payloads. Signing verifies
   the exact template, hash and signature; NIP-44 runs a self round trip.
4. Replace the frame, reload, test offline/online, and check again. Log out, then
   reload and verify that import is required. The signer-owned **Forget local
   test key** button also deletes the stored record if the parent is disconnected.

The signer stores raw disposable key bytes in its own IndexedDB. Automatic
restore is deliberately tested without an unlock ceremony. This provides no
password-based or hardware-backed at-rest claim. Keys are read per operation and
byte buffers are cleared afterwards; JavaScript cannot guarantee forensic memory
erasure. No key or wrapping key is stored in a parent origin. No import/export
operation exists in the message contract.

The installed-mode indicator is observational. The proof intentionally remains
accessible in Safari to test both contexts; production's installed-only option
is a later shared-UI UX gate.

## Repeatable local validation

```sh
bun test
bun run typecheck
bun run lint
bun run format:check
bun run test:browser
bun run test:browser:diagnostic
bun run build
```

Strict TypeScript covers the browser proof, static server, tests and Playwright.
The crypto dependency is pinned to `nostr-tools` 2.25.2. Subpath imports restrict
the signer bundle to event, NIP-19, NIP-44 and legacy NIP-04 decryption code and
their cryptographic dependencies; it contains no app/UI code or NDK.

Playwright runs Chromium and desktop WebKit without retries, screenshots, video
or traces. It uses synthetic keys, real cryptography and separate browser
origins. It is **not** physical iPhone/PWA evidence. No test publishes an event.
Protocol tests use real runtime disposable keys, including NIP-59 author seals
and ephemeral gift wraps for unsigned kind-14 and kind-16 rumors, checked against
independent `nostr-tools` helpers. This standalone prototype does
not install Conduit account authority or authenticate protected relay reads;
composed Market/Merchant integration remains gated.

### Observed desktop limitation

The diagnostic command retains two failing WebKit offline-emulation reload
probes (one per parent). Chromium passes these probes. This matches the failure
reported in [Playwright #42775](https://github.com/microsoft/playwright/issues/42775).
The assertions are unchanged, without retries or expected-failure suppression;
the diagnostic command exits nonzero while the limitation remains. A separate
manual **Browser diagnostics** workflow reproduces it without changing required
signer validation. This is an emulation gap, not physical-iPhone evidence.

Required browser checks use an actual outage of all three local servers for
each parent in Chromium and WebKit. They check durable restore, verified signing,
NIP-44, frame replacement, closing/reopening a page, logout and reimport while
the servers remain stopped. Loaded-page network emulation remains in the normal
lifecycle checks. Browser page reopening is not iOS process termination.

Runtime disposable fixture generation is a narrowly scoped development
exception. The fixture button is test equipment; it must be removed before any
production signer UI is prepared. Static credentials, diagnostic/export/network
sinks and real account keys are prohibited. See [repository guidance](AGENTS.md).

## Prepare an approved exact-origin device candidate

Do not deploy this experiment without explicit approval. First record three
approved HTTPS origins and the approved hosting target. An illustrative signer
hostname is not approval or provisioning evidence. No production host should be
overwritten by these probe shells.

Set `PROOF_MARKET_ORIGIN`, `PROOF_MERCHANT_ORIGIN` and `PROOF_SIGNER_ORIGIN` to
those exact origins, then run the build command. Values must be origins only:
no path, query, credentials, wildcard or trailing slash. Defaults are local test
origins and must not be used as iPhone evidence.

The command creates three **separate** artifact directories under
`dist/{market,merchant,signer}`. Each directory contains
only its own static page/script, style, offline worker and `_headers`; parent
directories also contain a PWA manifest/icon. Do not combine them under one origin.
The output is ignored by Git and is not part of normal app builds. The command
does not deploy. The `_headers` file requires a host that enforces it; for another
host apply equivalent response headers explicitly and verify them before use.

The signer must send exact `frame-ancestors` for the two parent origins, no CORS
allowance, and the generated restrictive CSP. Parents allow only the exact signer
in `frame-src`. The static worker caches only a fixed allowlist of public assets;
it never sees import or RPC data. Offline cold launches still need device proof.
Changing origins or code requires a new evidence run. Remove the test workers
and their static caches during cleanup, so old test assets cannot mask a rerun.

## Physical iPhone procedure

Use a physical iPhone, ordinary Safari (not Private Browsing), and the exact
approved origins. Record device model, iOS version/build, Safari version when
available, run date, candidate commit, origin triple, installation history and
whether content blockers or website-data settings differ from defaults. Do not
capture a UDID, IP, account identifier, nsec, clipboard, message or ciphertext.

Use four initial contexts: Safari Market, Safari Merchant, installed Market and
installed Merchant. Install each parent through Safari's Add to Home Screen and
launch its own icon; verify **Installed mode observed**. The two probes test the
origin/storage hypothesis. Before claiming the product gate passed, repeat the
same checks in actual installed Market/Merchant shells on those same approved
origins using a reviewed test-only embedding surface. That integration is still
gated; do not equate a renamed probe icon with the real application.

For **each** context:

1. Record the displayed parent and signer origins. Confirm the frame is on the
   approved signer origin before entering even a disposable nsec.
2. Before import, select **Check status**. Record absent/present/unavailable.
   If another context already has a record, record whether it is visible here;
   do not infer sharing from the hostname or a successful browser run.
3. If absent, prepare/import a disposable test key inside the frame. Record one
   separate import for that context. Verify status, signing and NIP-44.
4. Replace the signer frame and repeat status/signing/NIP-44. Reload the parent
   and repeat. Do not reimport to hide a failed restore.
5. Background the app, then swipe it away in the app switcher. Terminate Safari
   as well for the installed-app case. Reopen through the original icon (or
   original Safari URL) and repeat checks **without** entering a key. Repeat
   after a device restart and after at least one overnight interval; record
   elapsed time rather than claiming long-term persistence from one relaunch.
6. After one successful online load, enable Airplane Mode with Wi-Fi off. Test
   signing/NIP-44 in the already loaded page, replace the frame, and terminate/
   relaunch while offline. Record each separately: unavailable static assets
   and lost key storage are different failures. Return online and repeat without
   reimport, recording any recovery or required import.
7. Open a second view in the same storage partition. Log out in the first.
   Verify the other loses authority and cannot sign. Check Safari, Market PWA
   and Merchant PWA separately; isolated partitions may require separate logout.
8. Reload and fully terminate/relaunch after logout. The stored record must be
   absent and signing must fail until reimport. Reimport a disposable key and
   repeat signing/NIP-44. A logout failure must never be marked successful.
9. In a dedicated test browser profile/context, clear the signer's website data.
   Verify the explicit reimport path. Do not clear unrelated personal website
   data. If device UI cannot isolate this safely, record the storage-loss check
   as pending instead.
10. Log out in every test context, remove test Home Screen apps, and clear only
    the test origins' data/workers/caches. No forensic erasure claim is made.

Record only these content-free fields per row:

| Context            | Exact parent/signer origins | Initial record | Import needed | Signing / NIP-44 | Frame reload | Termination/relaunch | Offline warm / cold | Online return | Logout/reimport | Result  |
| ------------------ | --------------------------- | -------------- | ------------- | ---------------- | ------------ | -------------------- | ------------------- | ------------- | --------------- | ------- |
| Safari Market      | Pending approved origins    | Not run        | Unknown       | Not run          | Not run      | Not run              | Not run             | Not run       | Not run         | Pending |
| Safari Merchant    | Pending approved origins    | Not run        | Unknown       | Not run          | Not run      | Not run              | Not run             | Not run       | Not run         | Pending |
| Installed Market   | Pending approved origins    | Not run        | Unknown       | Not run          | Not run      | Not run              | Not run             | Not run       | Not run         | Pending |
| Installed Merchant | Pending approved origins    | Not run        | Unknown       | Not run          | Not run      | Not run              | Not run             | Not run       | Not run         | Pending |

Include device/iOS and candidate metadata above the table; separately label
probe-shell versus actual-application evidence. Screenshots should show only
cleared input fields and pass/fail text. Do not attach network bodies, storage
contents, console payloads or remote-inspector dumps.

## Decision rule

Passing browser tests establishes only local supporting evidence. Full integration
requires physical exact-origin persistence, a reviewed storage/logout explanation,
maintainer security sign-off, and a stable merged app base.

If embedded persistence fails, stop and retain the content-free matrix. First
distinguish blocked IndexedDB, partition-specific imports, eviction and missing
offline assets. A bounded next experiment may test signer-owned top-level import
and embedded restoration on the same exact origins, **only after review**. It
must still demonstrate signer-owned persistence and automatic restoration. If
that cannot work, retain external signers and return for a separate storage/UX
decision. Do not store key bytes, an automatically usable unwrapping key, or
equivalent decryption capability in Market/Merchant, or silently add passwords,
passkeys, a native signer or recovery infrastructure.

See [the security review](SECURITY.md) for the remaining approval and integration
boundaries. The approved local-key policy does not grant deployment or release
authority.

## CI and advisory review

CI validates locked dependencies, formatting, lint, strict types, real disposable
crypto/lifecycle tests, authored-history credential policy, separate-origin
browser boundaries and the static build. PR titles use scoped Conventional
Commits. Bun audit rejects high-severity advisories without inherited ignores;
OSV scans PRs, main and the weekly dependency schedule. Jobs have time limits,
read-only checkout tokens and pinned Actions. No browser traces or payload
artifacts are uploaded. This repository has no application smoke, telemetry,
preview deployment or release workflow.

Sudden review uses a separately controlled, credential-isolated reviewer.
Activation requires maintainer configuration and verified live delivery. Public
CI must not hold account credentials, review App keys or auth-refresh jobs.
After activation, eligible open, non-draft, same-repository PRs targeting `main`
receive advisory reviews; dependency-bot and `DO NOT MERGE` PRs are excluded.
Maintainers can request reruns with exact `/agent review` or `/agent simplify`
comments. Delivery is polled and may be delayed. Reviews do not approve merges,
device feasibility or security sign-off, and the former `agent-review-handoff`
context must not be required. Human review remains necessary.

## Acceptance evidence

| ID    | Standalone proof evidence                                                                                        | Remaining gate                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| LS-01 | Browser/standalone indicator and signer-owned import                                                             | Actual shared UI, installed-only option, external signer/browsing regressions and physical screenshots             |
| LS-02 | Exact origin/source contract, strict CSP, parent storage isolation, no raw-key RPC, locked dependencies          | Exact approved HTTPS origins, hosted headers/logging and security/release review                                   |
| LS-03 | IndexedDB recreation, frame/parent reload and actual local-server outage restoration                             | Physical iPhone Safari/PWA persistence, device/iOS, separate imports and offline cold launch                       |
| LS-04 | Real signing, independent-peer NIP-44/legacy decrypt and kind-14/kind-16 NIP-59 interoperability                 | Existing shared account/session adapter, protected reads and composed Market/Merchant flows                        |
| LS-05 | Conditional record deletion, revision/frame/correlation fences, pending cancellation, cross-view logout/reimport | Physical suspension/relaunch and per-partition logout, composed auth lifecycle                                     |
| LS-06 | Content-free UI/errors and scoped CSPRNG fixture policy checks                                                   | Merged client-policy update, maintainer threat sign-off and hosted privacy review                                  |
| LS-07 | Focused crypto/lifecycle/policy tests, strict typecheck, lint, formatting, build and browser checks              | Current-head hosted CI, two retained WebKit offline-emulation failures, physical iPhone and product smoke coverage |

The probe-shell smoke/Playwright suite adds boundary, import/restore, crypto,
reload, offline and logout checks on both parent probes. Actual Market/Merchant
smoke coverage is unchanged. No product integration, relay delivery, physical
persistence or release readiness is claimed by these supporting checks.
