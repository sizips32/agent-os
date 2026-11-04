# Feature and safety boundaries

This source package keeps the existing official Giselle profile as the sole live agent transport. The renderer is sandboxed with context isolation, no Node integration, no direct network permission and typed sender-checked IPC. Fixed app targets and opaque attachment/work IDs replace arbitrary shell and filesystem access. No credentials, profile settings, memories or operational approval records are migrated.

## Documents and selected ranges

Text files are decoded as bounded UTF-8. PDF text and scanned pages/image letters are extracted locally by a Swift PDFKit/Vision helper; OCR is not image understanding. DOCX/XLSX/PPTX are read by a sandboxed Rust helper process that accepts bounded ZIP/XML structures and reject encrypted, damaged, excessive or unsupported active content. The preview shows warnings and selected text range. Long or capped extraction requires user confirmation. Filename and delimiter overhead counts toward the 12,000-character request cap. Selecting or previewing never uploads a file. Removal/cancellation invalidates late reading results. Existing native-image gating remains.

## Local discovery and storage

Work/automation and faith/investment/daily tracks keep user facts and personal interpretations distinct. A question may be skipped; no problem is a valid result. Review and explicit draft application preserve the current composer and attachments. Application does not send a request. Combined requests above the cap are refused rather than truncated.

Explicit save stores the current question position, editable review, optional AI questions/answers and inclusion decision in an app-owned local JSON file. Each track keeps one current save and one recently deleted entry. Replacement requires confirmation; undo never overwrites a later save. Atomic writes, strict schema, revision checks, bounded size and symlink refusal protect state; malformed files are preserved and rejected. A durable application marker prevents repeated draft application after restart or delete/undo. The file is unencrypted and not synchronized externally. Old saved schemas are read; older app versions may reject newly added AI fields during downgrade.

## Optional AI follow-up

The user prepares an exact scope preview, reads the external-model usage/cost notice, consents and requests once. Only current structured answers are included. Attachments, the composer, other conversations and selected sessions are excluded. A fresh text-only official Giselle query uses `--ignore-rules` to skip local rules/memory injection without changing configuration or approval policy. It does not independently disable ordinary tools.

Request UUID reservation and work binding are durable before submission. Failure to bind discards prepared work instead of submitting. Duplicate clicks and restored records cannot replay the same reflection. A cancelled or incomplete preparation may consume the reflection's request allowance; a new reflection is a separate explicit action. Unknown results remain unknown and are only read, never automatically retried.

While the owned work runs, the app reads only that work's status with at most one outstanding query. Completion stops the reader, validates bounded strict JSON and displays one question at a time. Wrong-work replies, lookup failure, malformed output and observed tool-start events are rejected without submission retry. Cancellation/unmount invalidate late reads; if cancellation awaits child shutdown, the same work is read until terminal status. Restore alone does not poll or send.

The interpretation is tentative and can be accepted, edited or rejected. Questions are editable and may be skipped or stopped. Additional user answers are not sent back automatically. Only user-approved content is included in the reviewed draft; rejected interpretation and skipped answers are excluded. Editing included content invalidates a previously prepared draft for renewed confirmation. Save remains explicit.

After restart, the manual result reader uses the existing bounded conversation API, which omits tool messages. It cannot independently attest all prior tool activity. A completed transport receipt does not prove external task effects. Remote reversal, refund, doctrine/investment correctness and arbitrary macOS automation are not claimed.

## Run and stop

See the package README for npm installation, build, tests and packaging. Existing official Hermes and Giselle prerequisites are checked read-only. Packaging creates an unsigned local bundle; it does not install, sign, notarize or register login items. Close the app, choose Agent OS 종료 or press Cmd+Q for normal shutdown. The app stops only its owned CLI child. Save explicitly before quitting if reflection continuation is desired. Do not rerun live-model tests without approval for the exact intended request.

## Result visibility and Obsidian evidence

Clipboard operations preserve the chosen text. Confirmed deletion hides only a result occurrence in the app and can be undone after restart. The visibility store contains hashes only. Running, unknown or unverified results remain protected.

Obsidian search is limited to existing `0_INBOX` and `1_SEMANTIC_LAYER` folders, with optional safe subfolder, tags and topic filters. Each search reads every note in scope up to 5,000 entries, 3,000 notes, 32MiB, 10 path levels and a 2-second budget, ranks matches (title, then tag, then body, then path) and shows the top 30; each note is at most 64KiB. The result reports how many notes were searched and matched and how many were excluded as oversized, secret-like/unreadable, or by a cap. Hidden paths, secret-like content, conflicts and symlinks are excluded. It does not follow wiki links or embedded attachments. The user confirms at most eight selected ranges of up to 8,000 characters each, subject to the shared 12,000-character request limit including framing and system text. Source hashes are checked again during preparation.

Evidence requests use a new text-only official SDK path, never continuation of an ordinary conversation. Pinned source hashes, empty tool schemas, execution guards, stripped personal system/prefill/personality context, a fixed app system prompt and a macOS vault deny boundary constrain the request. Subprocesses, local network routes and unapproved hosts are denied by the runner. SDK drift blocks execution with no fallback to ordinary tools. This publication tests local guards and fixtures; it does not establish a provider round trip or comprehensive provider-side privacy guarantees.

Isolated results are stored locally as bounded question/answer records, not recovered from the ordinary Hermes conversation DB. They remain read-only after restart and cannot be upgraded to an ordinary tool conversation by explicit session selection. Fixed error code, stage and timestamp distinguish startup, SDK, protocol, provider and record failures from a user stop without storing raw errors. Unknown work cannot automatically replay.

INBOX drafts require an editable review and an exact preview before explicit save. Concurrent edits invalidate stale previews; switching a seeded result preserves dirty draft content for restoration. New-file publication uses directory handles, symlink refusal, no-replacement links and durable duplicate reservations. Executable Obsidian syntax is refused. Existing notes, semantic layers and MOCs are never overwritten. Related-note suggestions use local title/tag matches and create new draft versions only after confirmation. MOC changes remain copyable proposals. Syncthing propagation is external and unverified.
