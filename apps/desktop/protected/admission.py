"""Read-only admission check. Never imports or starts the Hermes agent runtime."""

import json
import os
import stat
import sys
from pathlib import Path


def restrict_process():
    def audit(event, args):
        if event in {
            "subprocess.Popen",
            "os.system",
            "os.posix_spawn",
            "socket.connect",
            "socket.bind",
        }:
            raise PermissionError("admission check forbids execution and network")
        if event == "open":
            mode, flags = args[1:3]
            if (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
                isinstance(flags, int)
                and flags
                & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            ):
                raise PermissionError("admission check is read-only")
        if event in {
            "os.remove",
            "os.rename",
            "os.mkdir",
            "os.rmdir",
            "os.chmod",
            "os.symlink",
            "os.link",
        }:
            raise PermissionError("admission check is read-only")

    sys.addaudithook(audit)


def inspect_config(config, presence):
    if not isinstance(config, dict):
        raise ValueError("invalid config")
    model = config.get("model", {})
    memory = config.get("memory", {})
    mcp = config.get("mcp_servers", {})
    plugins = config.get("plugins", {})
    if not all(isinstance(v, dict) for v in (model, memory, mcp, plugins)):
        raise ValueError("unsupported config shape")
    enabled = plugins.get("enabled", [])
    if not isinstance(enabled, list) or not isinstance(
        memory.get("memory_enabled", True), bool
    ):
        raise ValueError("unsupported config shape")
    return {
        "status": "blocked",
        "profile": "giselle",
        "provider": "openai-codex"
        if model.get("provider") == "openai-codex"
        else "other",
        "memoryEnabled": memory.get("memory_enabled", True),
        "memoryFilesPresent": presence,
        "memoryLoaded": False,
        "roundTripVerified": False,
        # Conservative declaration check: do not select a model or auxiliary service.
        # Native mode prevents the normal text/auxiliary vision routing branch.
        "nativeImageAllowed": model.get("supports_vision") is True
        and isinstance(config.get("agent", {}), dict)
        and config.get("agent", {}).get("image_input_mode") == "native",
        "enabledMcpCount": sum(
            isinstance(v, dict) and v.get("enabled", True) is not False
            for v in mcp.values()
        ),
        "enabledPluginCount": len(enabled),
        "automaticDispatch": False,
        "manualPolicy": config.get("approvals", {}).get("mode", "manual") == "manual",
        "singleQueryDeny": config.get("approvals", {}).get("single_query_mode", "deny")
        == "deny",
    }


def read_metadata(profile):
    # Reject linked profile/config/memory paths. No credentials, SOUL or memory bodies opened.
    for p in (profile.parent.parent, profile.parent, profile, profile / "memories"):
        if p.is_symlink() or not p.is_dir():
            raise ValueError("unsupported profile path")
    path = profile / "config.yaml"
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("unsupported config file")
        raw = source.read(262145)
    if len(raw) > 262144:
        raise ValueError("oversized config")
    import yaml

    config = yaml.safe_load(raw)
    present = all(
        (profile / "memories" / name).is_file()
        and not (profile / "memories" / name).is_symlink()
        for name in ("MEMORY.md", "USER.md")
    )
    return inspect_config(config, present)


if __name__ == "__main__":
    restrict_process()
    try:
        result = read_metadata(Path(sys.argv[1])) if len(sys.argv) == 2 else None
        if result is None:
            raise ValueError("missing fixed profile")
    except Exception:
        # Never expose parser exception text, configuration values or traceback.
        result = {"status": "unavailable", "automaticDispatch": False}
    print(json.dumps(result, separators=(",", ":")))
