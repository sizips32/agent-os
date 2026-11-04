# macOS startup readiness contract

`service_preflight.py` reads an existing LaunchAgent plist and reports whether its executable, working directory and explicit Python entrypoint exist. It never prints environment values, starts a service, opens a GUI or changes a configuration. A valid launch contract is not proof of runtime/dependency health.

The current diagnosis distinguishes three conditions: a configured legacy web UI directory/entrypoint is missing; UI attach exhausted its preparation budget before opening a client; recovery returned incomplete coverage rather than an exception. Missing source must be restored at an owner-approved location or the obsolete job retired explicitly; neither action is performed here.

`startup-readiness.patch` is a proposed patch to the existing `login_attach.py` and `login_reconcile.py`, not an installer. It extends the finite attach preparation window from 120 to 180 seconds, reports the stage of a blocker, retains timeout/no-duplicate protections, and separates a working preserved agent from readiness for new work. Unknown/blocked agents remain incomplete; no task is marked verified or complete. The pure readiness helpers are covered by `npm run test:services`.

Application requires backing up the two exact current scripts, checking the patch against those originals, placing `service_preflight.py` beside them, and a separately approved launch/login test. No operating script, LaunchAgent, server or agent has been changed or restarted by this source update. Patch application changes future startup behavior and must preserve the existing session inventory and approval boundaries. A rollback restores the two backups and removes only the added helper after ensuring no reader uses it.

## Approved local application, 2026-10-20

The owner subsequently authorized backing up and patching the two existing startup scripts and placing the helper beside them, without executing the startup/login flow or restarting an app, server or agent. That local application was completed. The obsolete `com.giselle.webui` job had no PID; its plist was backed up, the exact job was disabled and unloaded, and the original plist was preserved. Hermes and OpenClaw were left running. No replacement web server was installed.

These changes affect future startup behavior. Runtime readiness, next-login recovery and the cause of the existing preparation delay remain unverified; previous exit codes do not become successful results merely because the files changed. Rollback uses the locally recorded backups and restores the previous effective launchd disabled state only with owner authorization. The original web UI source must be reviewed before re-enabling it.
