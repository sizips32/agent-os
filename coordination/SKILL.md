---
name: ohha-coordination
description: Versioned Giselle coordination entry with default deny and exact, expiring owner approval. Preserves the existing ohha-control helper.
---
# Bounded existing-session coordination

Entry: `~/.hermes/ohha-coordination/current/registered_cli.py`.
Use the installed Python interpreter. This separate registration adds no daemon,
login job, OS permission, provider key or automatic task. Keep the existing
`ohha-control` skill and helper. Existing personalities, sessions, ownership,
storage routing and approval requirements still apply.

`python3 <entry> status` verifies registered file hashes and local bindings without
calling a model or Herdr. `task-report --task TASK` reads the existing central
ledger and artifact metadata. Neither command creates a task or claims completion.

For a future owner-authorized request, create a small owner-private (0600) JSON:

```json
{"task":"unique_task","profile":"jarvis","route":"specialist","prompt":"Exact bounded work and completion criteria","kind":"local_check","required_phases":["specialist-jarvis"]}
```

Only paul/james/jarvis/atelier and `specialist` or the supported `worker` route are
admitted. One task has immutable planned phases. Input is data, never a shell
command. `prepare --request FILE` resolves the existing target and input hash but
does not send, register a task or issue approval. Refuse busy, blocked, ambiguous,
changed or unavailable targets. Never switch to a new session or an example root.

The **human owner**, in their foreground interactive shell, runs
`approve --request FILE` and reviews the full target, exact prompt, budgets and
expiry. They must type `approve <full displayed proposal hash>`. The agent must
never drive this prompt, manufacture a grant, use an affirmative flag or assume
that registration approval authorizes later work. There is no `--yes` or
environment bypass. Approval lasts at most 300 seconds; wait at most 180 seconds,
Hermes turns at most 10 and its run budget at most 150 seconds. These are not an
API-call or monetary cap, and they do not force an existing remote job to stop.

After a genuine exact owner grant, Giselle may use
`dispatch --request FILE --approval ID` once. Missing approval is denied before
target discovery or ledger writes. The entry rechecks the target and approval
before sending. Worker discovery and control require a genuine foreground empty
Herdr-managed shell; never spoof caller context, use focus or drive another pane
to satisfy this requirement. The specialist route resumes only the unique existing
canonical Bot Chat when its active-session record permits it.

A timeout or uncertain receipt is **never permission to resend**. Inspect the
existing task and native result; do not repeat with a new task ID. The existing
Python collection API can collect a matching late result without another send.
No return code or native reply alone verifies the requested real-world effects.
Publication and live completion review remain blocked in this release.

This is a local owner-operated consent workflow, not isolation against malicious
code running as the same OS user. Do not expose it as a network service or share
the private approval directory. No actual collaboration round trip was tested;
the owner explicitly omitted that test. Preserve that limitation in reports.
