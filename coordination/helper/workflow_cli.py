"""Read-only CLI. No dispatch, registration, mutations, model imports, or environment overrides."""
import argparse,json
from pathlib import Path
from task_report import inspect_task,resolve_note
from workflow_routes import capture_managed_snapshot

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['task-report','resolve','managed-snapshot']);p.add_argument('--task')
    # Root overrides support isolated test data. Renderer callers never choose these paths.
    p.add_argument('--state',type=Path,default=Path.home()/'.hermes/profiles/giselle/runtime/ohha-control')
    p.add_argument('--vault',type=Path,default=Path.home()/'Desktop/Obsidian-Syncthing/MyObsidianVault')
    a=p.parse_args()
    if a.action=='managed-snapshot':value=capture_managed_snapshot(Path.home()/'.local/bin/herdr')
    elif a.action=='resolve':value=resolve_note(a.task,a.state,a.vault)
    else:value=inspect_task(a.task,a.state,a.vault)
    print(json.dumps(value,ensure_ascii=False,separators=(',',':')))
if __name__=='__main__':
    try:main()
    except (ValueError,OSError) as e:
        print(json.dumps({'error':'task_inspection_unavailable','code':str(e) if isinstance(e,ValueError) else 'io_unavailable'}));raise SystemExit(2)
