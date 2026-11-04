# Verification scope

## Rust Office reader migration (2026-11-04)

DOCX/XLSX/PPTX extraction moved from in-process `yauzl`/`fast-xml-parser` to the sandboxed Rust helper `apps/desktop/native/office-reader` (`zip` inflate-only, `quick-xml`, `regex`, `serde_json`). The TypeScript wrapper writes a 0600 temp file and runs the helper through the existing `sandbox-exec` network/write-denied runner.

| Check | Result |
|---|---|
| Differential parity (temporary, removed after use) | Legacy TS vs Rust on 20 synthetic inputs (17 tabled cases: entities, CDATA/BOM, nested tables, UTF-16 truncation with emoji, malformed XML, macro content type, XLSX shared/inline/formula/target rules, PPTX order; 1 path-traversal entry; 2 invalid ZIP byte inputs): deep-equal results and error codes. The first run diverged on multiple top-level elements; the Rust parser was then aligned with the former validator (several roots and trailing text accepted, leading text rejected). 4 local real Office files: 3 extracted identically, 1 rejected identically (`active_content`) |
| Intentional difference | Runs interleaved with other elements (e.g. hyperlinks) are now read in document order (`ABC`); the previous object-grouping parser produced `ACB`. Covered by a new regression test |
| Standalone desktop regression | 30 files / 308 tests passed against the real Rust binary |
| Rust | `cargo test` 2 passed; `cargo clippy --release` clean |
| TypeScript / build | Typecheck passed; `npm run build` produced `dist/native/office-reader` (arm64) |
| Coordination / services | 77 / 7 tests passed |
| Packaging | Not completed: `npm run package:protected` stopped because `node_modules/electron/dist` is absent; `node_modules/electron` was last modified before this change and the lockfile diff only removes the 11 parser packages. The packaged `office-reader` resource and the GUI app were not verified |

## Source 0.1.3 and approved local registration (2026-10-20)

The selected standalone export is validated independently of the larger development workspace. The owner approved local startup-script application, retirement of one idle obsolete WebUI job and a separate default-denied helper registration. Existing apps and agents were not restarted or stopped; no API key or OS permission was added.

| Check | Result |
|---|---|
| Standalone desktop regression | 30 files / 299 tests passed |
| TypeScript | Renderer and protected Electron checks passed |
| Build | Vite, Swift reader, Electron main/preload passed |
| Coordination contract | 77 synthetic tests passed, including owner-review, separate registration, exact grant, duplicate refusal and owner-root binding cases; native transport replaced with fakes |
| Startup readiness policy | 7 synthetic tests passed; legacy source absence remains a real blocker |
| Startup patch | Original files backed up, patch applied, helper placed and exact resulting source checked; startup/login flow not executed |
| Separate helper registration | Content-addressed release and additional Giselle skill registered; default deny and rejection without an approval verified; no real grant issued |
| Preservation | Existing helper/skill and central ledger metadata preserved; obsolete WebUI had no PID before being disabled/unloaded; selected existing services retained their PIDs |

Arm64 packaging passed, with both task reader modules, PDF/OCR reader, pinned node-pty runtime and arm64 native binding present. The app was not launched or installed. Changed-file hygiene review excludes runtime data, owner project paths and actual session records. Already-installed dependencies were reused without downloads or install hooks. Test counts exclude the unused upstream shell/Canvas modules and the unchanged root MVP.

**Actual collaboration is unverified: the owner explicitly omitted the real collaboration test.** The synthetic tests exercise the approval and transport contracts with fake processes and temporary records. They cannot establish actual provider responses, live target readiness, Herdr delivery atomicity, skill-catalogue refresh in an already-running Giselle, real Aside evidence collection, operating note delivery or complete collaboration effects. Startup/login execution and the newly built GUI runtime were also not tested. No existing collaboration feature or file was removed. These limitations do not prevent committing and publishing the source branch; they limit operational completion claims.

## Previous source export (2026-10-16)

Validation ran in a separate review workspace with the previously installed export dependencies copied locally; no dependency, credential or SDK installation was performed.

| Check | Result |
|---|---|
| TypeScript | `npm run typecheck`: renderer and Electron configurations passed |
| Build and packaging | `npm run package:protected` passed: React/Vite, Electron main/preload, Swift document reader and unsigned arm64 bundle; native reader and both new Python helpers verified in resources |
| Export regression suite | `npm test`: 24 files / 264 tests passed with one worker on macOS |
| Sandbox execution | Restricted runner initially failed five native sandbox tests; the complete suite passed with native execution permitted |
| Publication hygiene | 158 tracked/planned files checked: no prohibited runtime/data paths or credential patterns; the sole email match is upstream npm dependency metadata |
| Source scope | 30 selected runtime/renderer/test files synchronized, with test home-path portability adaptation; two Python helpers added to minimal packaging |

All tests use fixtures, temporary data or no-model SDK source checks. No real model request, actual Obsidian-note read/write, app installation, authentication change or login-item registration was performed. The local Hermes SDK is a prerequisite for the new compatibility tests; this does not certify arbitrary SDK versions or external provider behavior.

## Previous source export (99df0fe)

The protected runtime, helpers, tests and selected renderer files are copied from the approved development implementation. The workspace manifests retain only the protected app dependencies; the original repository MVP remains unchanged. This publication does not install or replace the running app.

| Check | Result |
|---|---|
| Dependency installation | `npm ci --offline --no-audit --no-fund`: 440 packages installed successfully |
| TypeScript | `npm run typecheck`: renderer and Electron configurations passed |
| Export regression suite | `npm test`: 19 files / 188 tests passed with one worker |
| Build and packaging | `npm run package:protected` passed: React/Vite, Electron main/preload, native macOS document reader and unsigned arm64 app bundle |
| Source scope | Protected source/helpers and selected renderer/build files match the approved development source |
| Publication hygiene | Runtime data, private reports, actual model responses, configuration, credentials, screenshots and build output excluded |

The exported tests cover document limits and archive validation, attachment admission, local reflection storage and deduplication, consent and request preparation, strict follow-up parsing, serialized completion polling, wrong-work and malformed responses, cancellation, failure/unknown recovery, lifecycle and IPC policy. They use fixtures and temporary data and send no model request.

The approved development workspace separately passed 117 files / 913 tests, typecheck, build and arm64 packaging. That larger suite includes upstream modules omitted from this selected export; its count is not the export suite count.

## Native observations

The approved installed implementation was checked in a sandboxed Electron window. Prior checks exercised existing app shortcuts, read-only profile diagnosis, session continuation/restoration and failed-auth UI. Local mock runs at 800×600 and 1291×860 verified automatic follow-up completion, keyboard handling and restoration without an automatic resend.

A separately authorized single synthetic follow-up request completed with one model call and no observed tool activity. The displayed reply contained the expected strict JSON interpretation and questions. An initial missing completion poll was then fixed and verified using local mocks and regression tests; the fix was not tested with an additional real model call. Actual request/reply records, session identifiers and screenshots are excluded from this publication.

These observations establish transport and local status behavior, not arbitrary remote task effects or provider-side cancellation. Tool-event rejection detects observed tool use; it does not enforce a provider-side tool ban. App shortcuts open existing apps and do not claim a messaging/API integration. Details are in [docs/FEATURES.md](docs/FEATURES.md).

## Boundaries

No login item, daemon, account credential, provider configuration or OS permission was added. The approved local application patched two existing scripts and disabled/unloaded only the idle obsolete WebUI job, preserving its original plist and backups. The new helper is separate from the preserved legacy helper and requires per-request approval; its terminal consent workflow is not OS isolation against other code running as the same user. Automatic startup at the next login was not tested. The packaged app is an unsigned local arm64 build, not a signed or notarized distribution. No new model request was made in this integration/publication stage. Remote workflow availability must be checked for the final published commit; local checks do not imply remote CI success.
