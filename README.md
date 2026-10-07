# Conduit Signer

MIT-licensed embedded utility for an existing Nostr NSEC, hosted on a separate
origin. The signer owns input validation, IndexedDB persistence, automatic
restoration, key operations and explicit logout. The connected app receives only
public identity and operation results. There is no identity creation, key export,
password, recovery flow or routine operation approval.

This prepares the supported utility; it does not activate Market/Merchant auth,
provision a hostname, deploy, or establish physical iPhone persistence. Production
requires maintainer security review and exact-origin device evidence. Validation
uses runtime-generated test identities.

## Supported surface and test harness

```sh
bun install --frozen-lockfile
bun run build          # supported signer only: dist/signer
bun run dev            # local harness: parents 7030/7031, signer 7032
bun run build:harness  # test equipment only: dist/harness/{market,merchant,signer}
```

The supported signer page asks for an **Existing NSEC** and offers **Import NSEC**.
The input clears before the asynchronous storage write. Invalid input never
replaces a stored account. Import succeeds only after durable storage completes.
A stored account restores automatically and hides the import form. **Log out and
remove key** deletes the record and revokes live views in the same storage
partition. Storage failure is shown as unavailable, never a successful import or
logout. After logout or storage loss, import the existing NSEC again.

The local parent probes at `http://localhost:7030` and `http://localhost:7031`
embed `http://localhost:7032`. They include pass/fail controls and a signer-side
**Prepare disposable import** fixture button. These exist only with `--harness`.
The probes consume the supported `EmbeddedSigner` endpoint, not a separate test
transport. The supported build contains no fixture code or parent probe assets;
each build replaces its generated signer directory to remove stale test assets.

The signer stores raw key bytes in its own IndexedDB, with no independent unlock
or at-rest protection claim. No key or wrapping capability lives in the parent.
Keys are read per operation and cleared afterwards; logout, cross-view changes
and frame shutdown invalidate pending work and clear active buffers. JavaScript,
browser copies and device backups prevent forensic-erasure guarantees.

The supported database is `conduit-signer`. Experimental PR #1 records in
`conduit-disposable-signer-proof` are deliberately not promoted: reimport the test
identity and remove the old test-origin data separately. Safari and installed
PWAs, and Market/Merchant partitions, may require separate imports and logouts.
Installed-only presentation belongs to the monorepo shared UI and is a UX gate.

## Validation

```sh
bun test
bun run typecheck
bun run lint
bun run format:check
bun run test:browser
bun run test:browser:diagnostic
bun run build
```

For a scoped authored-history scan, use `CREDENTIAL_BASE_SHA=origin/main bun test`.
A complete historical scan may exceed Bun's default five-second test budget;
`bun test --timeout 30000` runs the same assertions with a larger execution budget.
CI scans the explicit base/head range. No credential content is printed.

The only runtime dependency remains pinned `nostr-tools` 2.25.2. Subpath imports
cover complete verified Nostr events, NIP-44 v2 and decrypt-only legacy NIP-04.
Tests interoperate with an independent peer and NIP-59 kind-14/kind-16 envelopes;
no event is published. NIP-44 v3 remains gated on public draft/client references
and explicit capability detection.

Chromium and desktop WebKit use real crypto and distinct origins, with no retries,
traces, screenshots or videos. Tests cover ordinary input, failed persistence,
reload/restore, frame/account replacement, cross-view logout, cancellation,
malformed/stale responses and actual server outages. They are not physical
Safari/Home Screen evidence or composed Market/Merchant coverage. See
[INTEGRATION.md](INTEGRATION.md) for the exact existing-protocol adapter handoff.

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

Runtime fixture generation is a narrowly scoped test exception.
The fixture button is absent from the supported signer UI. Static credentials, diagnostic/export/network
sinks and real account keys are prohibited. See [repository guidance](AGENTS.md).

## Prepare an approved exact-origin device candidate

Do not deploy this utility without explicit approval. First record three
approved HTTPS origins and the approved hosting target. An illustrative signer
hostname is not approval or provisioning evidence. No production host should be
overwritten by these probe shells.

Set `PROOF_MARKET_ORIGIN`, `PROOF_MERCHANT_ORIGIN` and `PROOF_SIGNER_ORIGIN` to
those exact origins, then run `bun run build:preview`. This command fails unless all three explicit
HTTPS origins are provided. Values must be origins only:
no path, query, credentials, wildcard or trailing slash. Defaults are local test
origins and must not be used as iPhone evidence.

The command creates only `dist/signer`, with its static page/script, style,
offline worker and `_headers`. Deploy only that directory to the verified signer
hosting target. Parent probe artifacts require `build:harness` and must never
replace actual Market/Merchant applications. Do not combine origins.
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
origins using a reviewed test-only embedding surface. Composed preview integration has separate scope; do not equate a renamed probe icon with the real application.

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

Passing browser tests establishes only local supporting evidence. Production activation
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

| ID    | Utility and harness evidence                                                                                     | Remaining gate                                                                                                     |
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
