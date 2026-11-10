"""Fixed local diagnostics; no refresh, login, model call, or credential output."""

import io
import json
import logging
import os
import sys
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from admission import restrict_process, read_metadata


def diagnose():
    profile = Path.home() / ".hermes/profiles/giselle"
    try:
        v = read_metadata(profile)
    except Exception:
        return {"code": "profile_unavailable"}
    if not (v["provider"] == "openai-codex" and v["manualPolicy"] and v["singleQueryDeny"]):
        return {"code": "policy_mismatch"}
    if not (v["memoryEnabled"] and v["memoryFilesPresent"]):
        return {"code": "memory_unavailable"}
    os.environ["HERMES_HOME"] = str(profile)
    os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"
    sys.path.insert(0, str(Path.home() / ".hermes/hermes-agent"))
    try:
        # Official status contract explicitly uses resolve_codex_runtime_credentials(read_only=True).
        # Extra audit hook denies network, refresh writes and child processes even if upstream changes.
        from hermes_cli.auth import get_codex_auth_status

        status = get_codex_auth_status()
        if status.get("logged_in") is False:
            return {"code": "auth_required"}
        if status.get("logged_in") is not True:
            return {"code": "auth_unavailable"}
        if status.get("expired") is True:
            return {"code": "auth_required"}
    except Exception:
        return {"code": "auth_unavailable"}
    return {"code": "ready", "nativeImageAllowed": v.get("nativeImageAllowed") is True}


if __name__ == "__main__":
    restrict_process()
    logging.disable(logging.CRITICAL)
    # Third-party imports cannot accidentally print paths, config or token diagnostics.
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        try:
            result = diagnose()
        except Exception:
            result = {"code": "diagnostic_unavailable"}
    print(json.dumps(result, separators=(",", ":")))
