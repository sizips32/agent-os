"""Bundled read-only reader. Isolated Python, fixed caller-owned roots, no agents."""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

# -I removes ambient PYTHONPATH and user packages. Import only the bundled reader.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from task_report import inspect_task


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--task", required=True)
    p.add_argument("--state", required=True, type=Path)
    p.add_argument("--vault", required=True, type=Path)
    a = p.parse_args()
    print(json.dumps(inspect_task(a.task, a.state, a.vault), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error):
        print('{"error":"task_inspection_unavailable"}')
        raise SystemExit(2)
