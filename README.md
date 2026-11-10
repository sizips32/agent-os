# Agent OS protected desktop · source 0.1.3

The latest guarded Electron + React/Vite desktop is published here as a separate source package. The repository root retains the earlier Electron + FastAPI + SQLite MVP. Each has its own package manifest and launch command.

This package derives from [Herald OS](https://github.com/iamlukethedev/Herald-OS), upstream revision `3c891adcd1f5c3b6eeadf4d20472d10d9516a999`, with an initial protected source baseline at `d3ba5c29fd8a1ce635e05989da4a277a091f42a1` and its initial verification documentation at `1b279e9dff85dfb176dcfa304d533cd224140d65`; subsequent protected changes are recorded in this repository history. It includes the protected runtime, renderer, tests and required assets. Unused upstream OS/bootstrap/gateway modules are excluded. Workspace manifests are reduced to those dependencies; the avatar component retains only the existing HermesAvatar function. Runtime source and request behavior are preserved; exported tests replace developer-specific absolute home paths with the current home directory.

## Install, run and stop

Requires macOS, Node 22.12 or later and a Rust toolchain (`cargo`) to build the Office reader helper. For real Giselle requests, the user must already have the official Hermes CLI/Python installation and a compatible `giselle` profile with its existing OpenAI Codex authentication, memory and manual/single-query policy. The app diagnoses missing prerequisites and does not install Hermes, log in, refresh credentials or alter policies.

From the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

`npm run dev` builds and opens this protected Electron desktop. Closing its window, choosing **Agent OS 종료**, or pressing **Cmd+Q** stops the app and only its owned CLI request. Other opened apps remain running. Stop can leave a remote outcome unknown; it does not guarantee reversal of provider work or usage.

`npm test` uses synthetic fixtures and temporary test directories. One optional compatibility test uses an installed official SessionDB interface against a temporary fake database; it skips when that installation is absent. It never sends a model request. Renderer tests use jsdom; native document tests compile a temporary Swift helper on macOS, and a vitest global setup builds the Rust Office reader (`cargo build --release --locked`) so DOCX/XLSX/PPTX tests run against the real binary; they therefore need `cargo` (crates.io access on the first build) and working nested `sandbox-exec`. Obsidian SDK tests additionally require the existing official Hermes Python environment and SDK source; the no-model compatibility check validates pinned source hashes and blocks changed SDKs. Native sandbox tests require macOS and permission to run nested sandbox-exec in a local terminal. Tests do not log out, create login items or modify existing profile settings.

For an unsigned local arm64 bundle:

```sh
npm run package:protected
```

Output: `apps/desktop/release/protected/mac-arm64/Agent OS.app`. This creates a local build only. Installation, code signing, notarization and login registration are not performed. Handle macOS security warnings yourself; no quarantine or Gatekeeper bypass is included.

## Connections and controls

- **Giselle conversation:** explicit send through official Hermes CLI; response streaming, same-conversation continuation and exact session selection. After restart, select the previous submission or explicitly selected conversation to restore it; there is no automatic model resend or bulk history collection.
- **Stop:** retains partial text in the current view, records an unknown result and terminates the owned local CLI. An unknown conversation can be read but cannot be submitted again through continuation.
- **Samantha (existing ChatGPT host/Codex), Hermes, Buzz, Muse and Grok Bot:** open existing official macOS apps. These buttons do not send tasks or claim API integration. Samantha opens the existing ChatGPT-host application and leaves conversation selection to the user. The earlier MVP retains its separate dots handoff workflow.
- **Applications:** bounded local app enumeration/opening; no arbitrary shell or renderer filesystem bridge.
- **Read-only connection diagnosis:** explains profile/CLI/Python/auth/policy problems and blocks submission until prerequisites are compatible. A ready diagnosis is not a provider round-trip test.

Security boundaries: sandboxed renderer, context isolation, Node integration off, minimal typed sender-checked IPC, navigation and permissions denial, renderer network CSP, bounded input/output, durable deduplication and unknown quarantine. Hermes remains the authority for operational approvals and effects. Ordinary existing Hermes tools remain available; users must review actual work requests. This is not a general unrestricted macOS automation API.

Development data is under ignored `.local/` within this package. Packaged app data is under `~/Library/Application Support/Agent OS`: submission receipts, selected session references, result visibility hashes, isolated question/answer records, draft-save receipts and explicitly saved discovery reflections live there. Isolated result records contain the question and answer, but do not separately store selected evidence; an answer may quote evidence. Discovery saves can include user answers and AI questions; they are local, unencrypted, and never included in source or app packages. Existing Hermes authentication, configuration, memories and conversation bodies are not copied into Git or the app bundle. Selected bounded conversations are read from the existing profile only after explicit selection.

## Discovery, files and AI follow-up questions

- **Files:** select bounded TXT/MD/CSV/JSON, PDF, DOCX/XLSX/PPTX or image files; review extracted text/OCR and confirm the displayed range before sending. Document bodies, tables and selected OCR text use ordinary text transport. Unsupported, encrypted or active-content documents are rejected. DOCX/XLSX/PPTX archives are parsed by a separate Rust helper (`apps/desktop/native/office-reader`) under the same network/write-denied `sandbox-exec` profile as the Swift reader, never inside the Electron main process. Native image transport remains gated by the existing model compatibility check. The combined request, filenames and attachment delimiters must fit 12,000 characters without silent truncation.
- **Discovery:** work/automation and faith/investment/daily tracks offer local questions, editable review, tentative interpretations, explicit draft application and explicit save/restore/delete/undo. Draft application preserves the composer and attachments and sends nothing. A durable marker prevents duplicate application after restart.
- **Optional AI follow-up:** preview the exact current answers and external-model usage notice, consent, then request once through existing Giselle. A fresh text-only session uses the official `--ignore-rules` flag to omit local rules/memory injection; existing provider, manual approval and child sandbox remain. Up to three strict JSON questions appear one at a time, with interpretation accept/edit/reject, question editing, skipping and cancellation. Additional answers are not automatically sent. Only accepted user content is included in a reviewed draft.
- **Completion synchronization:** after start returns running, a serialized reader checks only that work ID. Completion automatically displays questions and releases the composer lock. Failed/unknown/error states stop automatic reading; cancellation and unmount invalidate late results. No model request is replayed. Recovery reads existing results explicitly; save/open/restore alone never starts a model request or polling.

Ordinary Hermes tools retain their existing permissions. The follow-up prompt requests no tool use, and observed tool-start events reject the proposal; this is not a hard tool-disable policy. After restart, recovered conversation content omits tool messages, so that path cannot independently verify all tool activity. AI interpretations are tentative, not established facts, doctrine or investment performance. See [feature boundaries](docs/FEATURES.md).

## License and evidence

Preserved [MIT LICENSE](LICENSE) and [NOTICE](NOTICE) identify upstream authors and third-party material. [SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md) explains the selected subset and modifications. This is an independent derivative, not an official Hermes or Nous Research product.

[VERIFICATION.md](VERIFICATION.md) distinguishes portable-source checks from prior native and real-model observations. Runtime data, private local paths, actual conversation transcripts, screenshots, credentials and built app bundles are excluded from publication.

## Result controls and Obsidian

Results support exact whole/selected-text copying and confirmed, reversible hiding in this app. Hiding preserves original Hermes conversations, input, attachments and execution receipts; running or unknown results cannot be hidden.

The current local vault convention is `~/Desktop/Obsidian-Syncthing/MyObsidianVault`. This export keeps that implementation convention; it does not discover or configure another vault. The vault must already contain `0_INBOX` and `1_SEMANTIC_LAYER`. Local search is bounded (5,000 entries, 3,000 notes, 32MiB, 10 levels, 2 seconds; top 30 ranked results), reports excluded notes, and follows no note links. Preview and explicitly confirm a selected range before adding it to a fresh evidence request. Only the confirmed question, selected ranges and text attachments enter that request. The pinned SDK adapter strips personal prompt overlays and tools, blocks child execution and vault access, and fails closed on SDK drift. Ordinary conversations retain their existing tool permissions. No real provider round trip was performed during this publication.

Results and reviewed discovery drafts can seed an editable INBOX draft. Saving requires preview and explicit confirmation and creates a new file without overwriting an existing note. Related-note links create another version; existing MOCs remain read-only proposals. Local saves may be synchronized by an already configured Syncthing installation; the app does not verify remote synchronization. See [feature boundaries](docs/FEATURES.md).

## Integrated source 0.1.3

The protected desktop now includes the app-owned foldable local terminal, read-only task/session/note-path projection, `_giselle` evidence search, updated no-model SDK compatibility checks, and accurate image OCR failure/partial-result handling. Apple OCR failure can retry an already-installed Tesseract behind the same network/write-denied boundary and total read budget. Missing language packs are reported honestly; no pack is downloaded. Partial OCR requires review before sending. Scanned PDF fallback is not included.

The native terminal requires the declared node-pty runtime. Packaging includes only its runtime JS and arm64 prebuilds; opening/closing the app is not part of source validation. The terminal accepts explicit user input and does not automatically resume an agent. Folding preserves the existing terminal; quitting asks before closing the app-owned shell.

The [coordination contract](coordination/README.md) includes a separately versioned registration path that preserves the existing helper, defaults to deny, and requires exact-target/input-hash/expiry approval for each future call. Actual owner roots stay in private local configuration. The [startup readiness patch](ops/macos/README.md) changes finite waiting and readiness reporting. The owner separately approved local script application, retirement of the idle obsolete WebUI job and registration of the new helper, without an app or agent restart, new OS permission or API key. Installing this source package alone does not perform those operations.

The owner explicitly omitted the real collaboration test. Actual team/Aside/claim-review/note/completion reporting, current agent skill-catalogue refresh and next-login recovery remain unverified. Existing collaboration features and files are retained. Passing local checks supports source preservation and branch publication; it does not certify the complete operating system.

Additional local checks:

```sh
npm run test:coordination
npm run test:services
```
