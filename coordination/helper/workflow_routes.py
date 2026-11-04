"""Explicit existing-profile routes. Live sends are deliberately unavailable in this candidate."""
from __future__ import annotations
from dataclasses import dataclass
import json, math, os, re, subprocess, time
from pathlib import Path
from task_report import task_id, readonly_connection

# Illustrative fixture bindings; deployment must bind reviewed existing targets.
TEAMS={'paul':('w2','projects/paul'),'james':('w4','projects/james'),
       'jarvis':('w6','projects/jarvis'),'atelier':('w7','projects/atelier')}
WORKERS={'claude','codex','grok','opencode','agy'}
@dataclass(frozen=True)
class Scope:
    task: str
    profiles: tuple[str,...]
    operations: tuple[str,...]
    expires_at: float
    synthetic: bool=False
    def require(self, task, profile, operation, *, synthetic):
        task_id(task)
        if task!=self.task or profile not in self.profiles or profile not in TEAMS or operation not in self.operations:raise ValueError('outside_approved_scope')
        if not math.isfinite(self.expires_at) or self.expires_at<=time.time():raise ValueError('scope_expired')
        if synthetic!=self.synthetic:raise ValueError('synthetic_scope_mismatch')

@dataclass(frozen=True)
class ManagedContext:
    marker: str|None
    workspace: str|None
    pane: str|None
    shell_parent: str|None
    herdr_parent: str|None
    def require(self, binary: Path):
        if self.marker!='1' or not re.fullmatch(r'w[0-9]+',self.workspace or '') or not re.fullmatch(re.escape(self.workspace)+r':p[A-Za-z0-9]+',self.pane or ''):raise ValueError('not_herdr_managed_context')
        if Path(self.shell_parent or '').name.lstrip('-') not in ('zsh','bash','sh','fish'):raise ValueError('not_an_existing_managed_shell')
        if self.herdr_parent is None or Path(self.herdr_parent).resolve()!=binary.resolve():raise ValueError('herdr_process_ownership_unconfirmed')

def current_context():
    # Only PID/name metadata. Never read process environment blocks, which may contain secrets.
    rows={}
    for line in subprocess.check_output(['/bin/ps','-axo','pid=,ppid=,comm='],text=True).splitlines():
        parts=line.strip().split(None,2)
        if len(parts)==3:rows[int(parts[0])]=(int(parts[1]),parts[2])
    parent=rows.get(os.getppid());grand=rows.get(parent[0]) if parent else None
    return ManagedContext(os.environ.get('HERDR_ENV'),os.environ.get('HERDR_WORKSPACE_ID'),os.environ.get('HERDR_PANE_ID'),parent[1] if parent else None,grand[1] if grand else None)

def capture_managed_snapshot(binary: Path):
    # This is the only native Herdr adapter and its entire command set is read-only.
    context=current_context();context.require(binary)
    if not os.isatty(0) or os.tcgetpgrp(0)!=os.getpgrp():raise ValueError('not_the_foreground_managed_shell')
    def read(args):
        r=subprocess.run([str(binary),*args],capture_output=True,text=True,timeout=8,check=False)
        try:data=json.loads(r.stdout)
        except ValueError:raise ValueError('native_read_unavailable') from None
        if r.returncode or 'error' in data:raise ValueError('native_read_rejected')
        return data['result']
    pane=read(['pane','current','--current']);pane=pane.get('pane',pane)
    if pane.get('pane_id')!=context.pane:raise ValueError('caller_pane_mismatch')
    agents=read(['agent','list']).get('agents',[])
    if any(a.get('pane_id')==context.pane and a.get('agent') for a in agents):raise ValueError('caller_shell_is_not_empty')
    allowed=[]
    for a in agents:
        if a.get('workspace_id') not in {v[0] for v in TEAMS.values()}:continue
        allowed.append({k:a.get(k) for k in ('workspace_id','pane_id','agent','agent_status','agent_session','cwd','foreground_cwd')})
    return {'provenance':'native_herdr_managed_read','captured_at':time.time(),'caller_pane':context.pane,'agents':allowed,'synthetic':False}

def canonical_profile(home: Path, profile: str):
    if profile not in TEAMS:raise ValueError('unknown_existing_profile')
    root=home/'.hermes/profiles'/profile
    db=readonly_connection(root/'state.db')
    if db is None:raise ValueError('profile_database_missing')
    try:rows=db.execute("SELECT id FROM sessions WHERE title='Bot Chat' AND profile_name=?",(profile,)).fetchall()
    finally:db.close()
    if len(rows)!=1:raise ValueError('existing_bot_chat_not_unique')
    sid=rows[0][0]
    if not isinstance(sid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',sid):raise ValueError('existing_session_identity_invalid')
    active=json.loads((root/'runtime/active_sessions.json').read_text()).get('entries',[])
    if any(a.get('session_id')==sid or a.get('metadata',{}).get('live_session_id')==sid for a in active):raise ValueError('canonical_profile_busy')
    return {'profile':profile,'session':sid,'source_kind':'existing_hermes_bot_chat'}

def existing_team_plan(task, profile, scope: Scope, home: Path, snapshot, worker_kind='claude'):
    if type(snapshot.get('synthetic')) is not bool:raise ValueError('snapshot_mode_required')
    synthetic=snapshot['synthetic']
    scope.require(task,profile,'plan',synthetic=synthetic)
    provenance='synthetic_fixture' if synthetic else 'native_herdr_managed_read'
    if snapshot.get('provenance')!=provenance:raise ValueError('snapshot_provenance_missing')
    age=time.time()-snapshot.get('captured_at',0)
    if age<0 or age>30:raise ValueError('stale_snapshot')
    if worker_kind not in WORKERS:raise ValueError('unknown_worker_kind')
    canonical=canonical_profile(home,profile);workspace,relative=TEAMS[profile];expected=home/relative
    candidates=[a for a in snapshot.get('agents',[]) if a.get('workspace_id')==workspace and a.get('agent')==worker_kind]
    if len(candidates)!=1:raise ValueError('worker_binding_not_unique')
    worker=candidates[0]
    if worker.get('agent_status') not in ('idle','done'):raise ValueError('worker_not_ready')
    if Path(worker.get('cwd',''))!=expected or Path(worker.get('foreground_cwd') or worker.get('cwd',''))!=expected:raise ValueError('worker_root_mismatch')
    pane=worker.get('pane_id','');sid=(worker.get('agent_session') or {}).get('value')
    if not re.fullmatch(re.escape(workspace)+r':p[A-Za-z0-9]+',pane) or not isinstance(sid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',sid):raise ValueError('worker_identity_missing')
    return {'task_id':task,'route_kind':'existing_profile_and_herdr_worker','specialist':canonical,
            'worker':{'profile':profile,'workspace':workspace,'pane':pane,'session':sid,'kind':worker_kind,'source_kind':'existing_herdr_worker'},
            'synthetic':synthetic,'execution':'plan_only','live_dispatch_enabled':False,'requires_fresh_owner_approval':True}

def dispatch_live(*_args, **_kwargs):
    raise PermissionError('live_dispatch_not_authorized_in_this_candidate')
