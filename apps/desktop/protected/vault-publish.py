"""Publish only a complete app draft, using directory capabilities and no replacement."""

import os
import sys
import json
import stat
import hashlib
import re


def open_directory(p):
    if not os.path.isabs(p):
        raise ValueError("absolute root required")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in p.split("/")[1:]:
            if not part or part in (".", ".."):
                raise ValueError("invalid directory")
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
        return fd
    except:
        os.close(fd)
        raise


def identity(st):
    return (st.st_dev, st.st_ino)


def publish(root, source, name, expected, before_link=None, destination="0_INBOX"):
    if not re.fullmatch(r"AgentOS-[a-f0-9-]{36}\.md", name) or not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("invalid draft identity")
    if destination not in ("0_INBOX", "_giselle/OH-HA_Agent_OS/Records"):
        raise ValueError("invalid destination")
    rootfd = open_directory(root)
    inboxfd = None
    chain = []
    try:
        parent = rootfd
        for component in destination.split("/"):
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            chain.append((parent, component, child, identity(os.fstat(child))))
            parent = child
        inboxfd = parent

        def anchored():
            check = open_directory(root)
            try:
                if identity(os.fstat(check)) != identity(os.fstat(rootfd)):
                    raise ValueError("vault changed")
            finally:
                os.close(check)
            for parent, component, child, opened in chain:
                current = os.stat(component, dir_fd=parent, follow_symlinks=False)
                if not stat.S_ISDIR(current.st_mode) or identity(current) != opened:
                    raise ValueError("destination changed")

        anchored()
        f = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            st = os.fstat(f)
            if not stat.S_ISREG(st.st_mode) or st.st_size > 65536:
                raise ValueError("input limit")
            data = b""
            while len(data) <= 65536:
                part = os.read(f, 65537 - len(data))
                if not part:
                    break
                data += part
            if len(data) > 65536 or hashlib.sha256(data).hexdigest() != expected:
                raise ValueError("staged draft changed")
        finally:
            os.close(f)
        anchored()
        if before_link:
            before_link()
        try:
            os.link(source, name, dst_dir_fd=inboxfd, follow_symlinks=False)
        except FileExistsError:
            anchored()
            return {"exists": True}
        try:
            anchored()
            os.fsync(inboxfd)
        except:
            os.unlink(name, dir_fd=inboxfd)
            raise
        return {"created": True}
    finally:
        for _, _, child, _ in reversed(chain):
            os.close(child)
        os.close(rootfd)


if __name__ == "__main__":
    try:
        args = sys.argv[1:]
        if len(args) not in (4, 5):
            raise ValueError("invalid args")
        print(json.dumps(publish(*args[:4], destination=args[4] if len(args) == 5 else "0_INBOX")))
    except Exception:
        print(json.dumps({"error": "Draft publish boundary changed or unavailable; no replacement"}))
        sys.exit(1)
