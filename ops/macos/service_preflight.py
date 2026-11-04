"""Read-only launch-contract and startup readiness policy. Never starts a service."""
from __future__ import annotations
import argparse,json,plistlib,time
from pathlib import Path

def inspect_launch_agent(path: Path):
    path=Path(path)
    if path.is_symlink() or not path.is_file():raise ValueError('launch_agent_must_be_regular_file')
    config=plistlib.loads(path.read_bytes());cwd=config.get('WorkingDirectory');args=config.get('ProgramArguments',[])
    if not isinstance(args,list) or not args or not all(isinstance(a,str) for a in args):raise ValueError('unsupported_launch_contract')
    program=Path(config.get('Program') or args[0]);working=Path(cwd) if isinstance(cwd,str) else None
    issues=[]
    if not program.is_absolute() or not program.is_file():issues.append('executable_missing')
    if working is not None and (not working.is_absolute() or not working.is_dir()):issues.append('working_directory_missing')
    # Inspect only an explicit Python source entrypoint; never parse command strings or secrets.
    if program.name.startswith('python') and len(args)>1 and args[1].endswith('.py'):
        entry=Path(args[1]);entry=entry if entry.is_absolute() else working/entry if working else None
        if entry is None or not entry.is_file():issues.append('entrypoint_missing')
    return {'read_only':True,'label':config.get('Label'),'configured':not issues,'issues':issues,
            'runtime_verified':False,'action_taken':'none','restart_required_for_loaded_config_changes':True}

def wait_for_server(status,*,timeout=180,clock=time.monotonic,sleep=time.sleep):
    """Bounded readiness observations only. No GUI open, start, replay or environment edits."""
    if type(timeout) not in (int,float) or not 0<timeout<=180:raise ValueError('invalid_wait_budget')
    end=clock()+timeout;observations=0
    while True:
        remaining=end-clock()
        if remaining<=0:return {'ready':False,'stage':'waiting_server','observations':observations,'action_taken':'none'}
        observations+=1
        if status(min(5,remaining)) is True:return {'ready':True,'stage':'server_ready','observations':observations,'action_taken':'none'}
        sleep(min(1,max(0,end-clock())))

def classify_seat(row):
    """Process presence, ability to receive work and task completion are different facts."""
    if row.get('ready') is True:return 'ready'
    if row.get('process_running') is True and row.get('native_status')=='working':return 'working_preserved'
    if row.get('process_running') is True and row.get('native_status')=='blocked':return 'approval_or_input_required'
    if row.get('process_running') is True:return 'running_unverified'
    return 'unavailable'

def reconcile_summary(rows):
    states=[classify_seat(row) for row in rows]
    return {'ready_count':states.count('ready'),'working_preserved_count':states.count('working_preserved'),
            'attention_count':sum(s not in ('ready','working_preserved') for s in states),
            'initialized':bool(states) and all(s in ('ready','working_preserved') for s in states),
            'all_ready_for_new_work':bool(states) and all(s=='ready' for s in states),
            'task_completion_verified':False,'states':states}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--plist',type=Path,required=True);a=p.parse_args()
    result=inspect_launch_agent(a.plist);print(json.dumps(result));return 0 if result['configured'] else 2
if __name__=='__main__':raise SystemExit(main())
