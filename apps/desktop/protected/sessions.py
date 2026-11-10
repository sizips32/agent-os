"""App-owned or selected Giselle sessions only, using official read-only SessionDB.
No agent initialization, model call, DB copy or app-owned transcript cache.
"""

import io
import math
import logging
from contextlib import redirect_stdout, redirect_stderr
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from admission import restrict_process


def safe_route(db, metadata):
    if db.session_yolo_enabled(dict(metadata)):
        raise ValueError("unsafe session policy")
    runtime = db.session_gateway_runtime(dict(metadata))
    if runtime.get("provider") not in (None, "", "openai-codex"):
        raise ValueError("session provider differs from Giselle")
    if runtime.get("base_url") not in (None, "", "https://chatgpt.com/backend-api/codex"):
        raise ValueError("session endpoint differs from fixed Codex route")


def read_selected(db, session_id, redact):
    allowed = {"cli", "oneshot", "desktop", "tui"}
    # Do not fetch get_session's system_prompt (which can contain memory).
    meta = db._read_one("SELECT id,source,model_config,billing_provider FROM sessions WHERE id = ?", (session_id,))
    if not meta:
        raise LookupError("session not found")
    if meta["id"] != session_id or meta["source"] not in allowed:
        raise ValueError("session ownership/source unavailable")
    safe_route(db, meta)
    ancestors = db._resume_lineage_ids(session_id)
    chain = db.get_compression_chain(ancestors[0]) if ancestors else []
    if not chain or len(chain) > 100:
        raise ValueError("unsupported lineage")
    messages, remaining = [], 60000
    # Only this logical conversation. Never query unrelated sessions or memory.
    for current in reversed(chain):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", current):
            raise ValueError("invalid lineage")
        m = db._read_one("SELECT id,source,model_config,billing_provider FROM sessions WHERE id = ?", (current,))
        if not m or m["source"] not in allowed:
            raise ValueError("unsafe lineage")
        safe_route(db, m)
        rows = db.get_messages(current, limit=61, latest=True)
        segment = []
        for row in reversed(rows):
            if row.get("role") not in ("user", "assistant") or not isinstance(row.get("content"), str):
                continue
            body = redact(row["content"], force=True)
            body = body[: min(12000, remaining)]
            if body:
                segment.insert(0, {"role": row["role"], "text": body})
                remaining -= len(body)
            if remaining <= 0 or len(messages) + len(segment) >= 60:
                break
        messages = segment + messages
        if remaining <= 0 or len(messages) >= 60:
            break
    return {"sessionId": chain[-1], "messages": messages, "limited": True, "lineage": chain}


def metadata_only_db(SessionDB):
    class MetadataOnlyDB(SessionDB):
        def get_session(self, session_id):
            row = self._read_one(
                "SELECT id,source,model_config,parent_session_id,end_reason,billing_provider FROM sessions WHERE id = ?",
                (session_id,),
            )
            return dict(row) if row else None

    return MetadataOnlyDB


def read_summary(db, session_id, redact):
    """First genuine user question only; no saved/LLM title or transcript returned."""
    allowed = {"cli", "oneshot", "desktop", "tui"}
    meta = db._read_one("SELECT id,source,model_config,billing_provider FROM sessions WHERE id = ?", (session_id,))
    if not meta or meta["id"] != session_id or meta["source"] not in allowed:
        raise ValueError("session ownership/source unavailable")
    safe_route(db, meta)
    ancestors = db._resume_lineage_ids(session_id)
    chain = db.get_compression_chain(ancestors[0]) if ancestors else []
    if not chain or len(chain) > 100 or session_id not in chain:
        raise ValueError("unsupported lineage")
    for current in chain:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", current):
            raise ValueError("invalid lineage")
        m = db._read_one("SELECT id,source,model_config,billing_provider FROM sessions WHERE id = ?", (current,))
        if not m or m["source"] not in allowed:
            raise ValueError("unsafe lineage")
        safe_route(db, m)
    for current in chain:
        rows = db.get_messages(current, limit=61, latest=False, include_compacted=True)
        for row in rows:
            if row.get("role") != "user" or row.get("_compressed_summary") or not isinstance(row.get("content"), str):
                continue
            body = redact(row["content"][:12000], force=True)
            body = re.sub(r"[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]", " ", body)
            body = " ".join(body.split())
            # A sensitive first question gets an honest fallback, not a secret-bearing label.
            title = (
                None
                if not body or re.search(r"redact|\[masked\]|<masked>", body, re.I)
                else body[:80] + ("…" if len(body) > 80 else "")
            )
            timestamp = row.get("timestamp")
            started = (
                timestamp
                if isinstance(timestamp, (float, int))
                and not isinstance(timestamp, bool)
                and math.isfinite(timestamp)
                and 0 < timestamp < 4102444800
                else None
            )
            return {"title": title, "startedAt": started}
        if len(rows) >= 61:
            # Do not mistake a later segment's question for the first beyond the bounded page.
            break
    return {"title": None, "startedAt": None}


def main():
    root = Path.home() / ".hermes/hermes-agent"
    profile = Path.home() / ".hermes/profiles/giselle"
    database = profile / "state.db"
    for p in (profile.parent.parent, profile.parent, profile, database):
        if p.is_symlink() or not p.exists():
            raise ValueError("unsupported fixed profile")
    summary = len(sys.argv) == 3 and sys.argv[2] == "--summary"
    session_id = sys.argv[1] if len(sys.argv) == 2 or summary else ""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", session_id) or session_id in ("latest", "default"):
        raise ValueError("exact session required")
    os.environ["HERMES_HOME"] = str(profile)
    os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"
    sys.path.insert(0, str(root))
    from hermes_state import SessionDB
    from agent.redact import redact_sensitive_text

    with metadata_only_db(SessionDB)(db_path=database, read_only=True) as db:
        return (
            read_summary(db, session_id, redact_sensitive_text)
            if summary
            else read_selected(db, session_id, redact_sensitive_text)
        )


if __name__ == "__main__":
    restrict_process()
    logging.disable(logging.CRITICAL)
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        try:
            result = main()
        except LookupError:
            result = {"error": "session_not_found"}
        except Exception:
            result = {"error": "session_unavailable"}
    print(json.dumps(result, separators=(",", ":")))
