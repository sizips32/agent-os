"""Exact existing-session transport. No CLI/IPC activation; deny-live is the default."""
from __future__ import annotations
import hashlib,json,os,sqlite3,time
from dataclasses import dataclass
from pathlib import Path
import subprocess
from task_report import task_id
from workflow_ledger import canonical
from workflow_routes import canonical_profile,capture_managed_snapshot,TEAMS
from delivery_approval import DenyLiveApproval
from native_results import specialist_final,worker_final,claude_transcript,content,specialist_request_exists

@dataclass(frozen=True)
class Command:
    argv:tuple[str,...]
    cwd:Path
    output:Path
    wait_seconds:int
    synthetic:bool

class NativeProcessPort:
    synthetic=False
    def __init__(self):self.children={}
    def execute(self,command:Command,started=None):
        if command.synthetic:raise PermissionError('native_process_port_refuses_synthetic_commands')
        # No shell, no inherited stdin, no new credentials, no process termination on timeout.
        flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW
        fd=os.open(command.output,flags,0o600)
        with os.fdopen(fd,'w') as stream:
            child=subprocess.Popen(list(command.argv),cwd=command.cwd,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
            self.children[child.pid]=child
            if started:started({'pid':child.pid})
            try:
                code=child.wait(timeout=command.wait_seconds)
                self.children.pop(child.pid,None)
                return {'pid':child.pid,'exit_code':code,'timed_out':False}
            except subprocess.TimeoutExpired:return {'pid':child.pid,'exit_code':None,'timed_out':True}

class DeliveryService:
    def __init__(self,ledger,home:Path,state:Path,*,approvals=None,port=None,snapshot=None,source_check=None,teams=None):
        self.ledger=ledger;self.home=Path(home);self.state=Path(state)
        self.teams=TEAMS if teams is None else teams
        self.approvals=approvals or DenyLiveApproval();self.port=port or NativeProcessPort()
        self.snapshot=snapshot or (lambda:capture_managed_snapshot(self.home/'.local/bin/herdr'))
        self.source_check=source_check or self._check_sources
        # Additive metadata only; never drop an uncertain claim or existing attempt.
        with ledger.db:
            ledger.db.execute('CREATE TABLE IF NOT EXISTS workflow_delivery_claims(task TEXT,phase TEXT,target TEXT,active INTEGER NOT NULL,PRIMARY KEY(task,phase))')
            ledger.db.execute('CREATE UNIQUE INDEX IF NOT EXISTS workflow_delivery_target ON workflow_delivery_claims(target) WHERE active=1')
            ledger.db.execute("CREATE UNIQUE INDEX IF NOT EXISTS workflow_delivery_session ON workflow_delivery_claims(json_extract(target,'$.route'),json_extract(target,'$.profile'),json_extract(target,'$.session')) WHERE active=1")
    def _check_sources(self):
        # This pin is generated from the local official parser and installed Herdr guide.
        record=json.loads((Path(__file__).parent/'delivery-interfaces.json').read_text())
        for item in record['pins']:
            actual=self.home/item['relative_path']
            if hashlib.sha256(actual.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('native_interface_changed_revalidate_first')
        from control import runtime_contract
        runtime_contract(self.home/'.hermes/hermes-agent')
    def _wire(self,task,phase,prompt):
        task_id(task);task_id(phase)
        if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>6000 or '\0' in prompt:raise ValueError('bounded_prompt_required')
        return 'OHHA_TASK_ID='+task+'\nOHHA_PHASE='+phase+'\n'+prompt
    def _target(self,task,profile,route):
        if profile not in self.teams:raise ValueError('unknown_existing_profile')
        project=self.home/self.teams[profile][1]
        if project.is_symlink() or not project.is_dir():raise ValueError('existing_project_root_unavailable')
        if route=='specialist':
            value=canonical_profile(self.home,profile)
            return {'route':'specialist-resume','profile':profile,'session':value['session'],'cwd':str(project)}
        snapshot=self.snapshot()
        if snapshot.get('synthetic') is not self.ledger.contract(task)['synthetic']:raise ValueError('snapshot_mode_mismatch')
        if snapshot.get('provenance')!=('synthetic_fixture' if snapshot['synthetic'] else 'native_herdr_managed_read') or not 0<=time.time()-snapshot.get('captured_at',0)<=30:raise ValueError('untrusted_or_stale_snapshot')
        # Only the Claude native result format was previously verified; other kinds are refused.
        workspace,relative=self.teams[profile];root=self.home/relative
        workers=[a for a in snapshot.get('agents',[]) if a.get('workspace_id')==workspace and a.get('agent')=='claude']
        if len(workers)!=1:raise ValueError('existing_team_worker_not_unique')
        a=workers[0];session=(a.get('agent_session') or {}).get('value');pane=a.get('pane_id')
        import re
        if a.get('agent_status') not in ('idle','done') or Path(a.get('cwd',''))!=root or Path(a.get('foreground_cwd') or a.get('cwd',''))!=root:raise ValueError('existing_team_worker_not_ready_at_root')
        if not isinstance(pane,str) or not re.fullmatch(re.escape(workspace)+r':p[A-Za-z0-9]+',pane):raise ValueError('worker_pane_binding_invalid')
        task_id(session)
        if not claude_transcript(self.home,profile,session,teams=self.teams):raise ValueError('existing_native_worker_transcript_required')
        return {'route':'herdr-agent-prompt','profile':profile,'session':session,'workspace':workspace,'pane':pane,'kind':'claude','cwd':str(root)}
    def _reserve(self,task,phase,target,scope):
        key=canonical(target);digest=hashlib.sha256(canonical(scope).encode()).hexdigest()
        try:
            with self.ledger.db:
                self.ledger.db.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?)',(task,phase,digest,'reserved',None,time.time()))
                self.ledger.db.execute('INSERT INTO workflow_delivery_claims VALUES(?,?,?,1)',(task,phase,key))
        except sqlite3.IntegrityError:raise ValueError('already_reserved_or_target_owned_never_resend') from None
    def _settle(self,task,phase,state,result,*,release):
        result['state']=state
        # Persist the receipt before releasing target ownership. A disk failure stays reserved.
        self.ledger.fact(task,'transport',phase+'-'+state,{'state':state,'synthetic':self.ledger.contract(task)['synthetic'],'receipt_sha256':hashlib.sha256(canonical(result).encode()).hexdigest()})
        with self.ledger.db:
            self.ledger.db.execute('UPDATE attempts SET state=?,result=?,updated=? WHERE task=? AND phase=?',(state,canonical(result),time.time(),task,phase))
            if release:self.ledger.db.execute('UPDATE workflow_delivery_claims SET active=0 WHERE task=? AND phase=?',(task,phase))
    def _links(self,task,phase,route,target,proof=None):
        self.ledger.link(task,'delivery-'+phase,role=route,phase=phase,profile=target['profile'],session=target['session'],source_kind='existing_hermes_bot_chat' if route=='specialist' else 'existing_herdr_worker',**({'workspace':target['workspace'],'pane':target['pane']} if route=='worker' else {}))
        if proof is not None:
            self.ledger.link(task,'final-'+phase,role='native_result',phase=phase,profile=target['profile'],session=target['session'],source_kind=proof['source_kind'],native_user_id=proof['native_user_id'],native_final_id=proof['native_final_id'],sha256=proof['sha256'])
    def dispatch(self,task,profile,route,prompt,approval_id):
        if isinstance(self.approvals,DenyLiveApproval):raise PermissionError('live_operator_approval_integration_not_enabled')
        if route not in ('specialist','worker'):raise ValueError('unsupported_delivery_route')
        contract=self.ledger.contract(task);phase=route+'-'+profile
        if phase not in contract['required_phases']:raise ValueError('unplanned_phase')
        if bool(self.port.synthetic)!=contract['synthetic']:raise PermissionError('transport_mode_mismatch')
        wire=self._wire(task,phase,prompt);wire_hash=hashlib.sha256(wire.encode()).hexdigest()
        self.source_check();target=self._target(task,profile,route)
        expected={'task':task,'phase':phase,**target,'prompt_sha256':wire_hash}
        approval=self.approvals.authorize(approval_id,expected,synthetic=contract['synthetic'])
        # Refuse a native matching request even if an older caller failed to record its attempt.
        if route=='specialist' and specialist_request_exists(self.home,profile,target['session'],wire):raise ValueError('native_request_already_exists_never_resend')
        if route=='worker' and any(isinstance(content(r),str) and hashlib.sha256(content(r).encode()).hexdigest()==wire_hash for r in claude_transcript(self.home,profile,target['session'],teams=self.teams) if r.get('type')=='user'):raise ValueError('native_request_already_exists_never_resend')
        self._reserve(task,phase,target,{**expected,'approval_sha256':approval['approval_sha256']})
        receipt={'task_id':task,'phase':phase,'synthetic':contract['synthetic'],**target,'wire_sha256':wire_hash,'approval_id':approval_id,'approval_sha256':approval['approval_sha256'],'verification':'unverified'}
        self._settle(task,phase,'reserved',receipt,release=False)
        try:
            # Re-read ownership and approval immediately before preparing the native call.
            if self._target(task,profile,route)!=target:raise ValueError('target_changed_before_delivery')
            renewed=self.approvals.authorize(approval_id,expected,synthetic=contract['synthetic'])
            if renewed!=approval:raise ValueError('approval_changed_before_delivery')
            if self.state.is_symlink() or not self.state.is_dir():raise ValueError('unsafe_delivery_state')
            request=self.state/(task+'-'+phase+'-request.txt');output=self.state/(task+'-'+phase+'-stdout.jsonl')
            if output.exists() or output.is_symlink():raise ValueError('prior_output_preserved')
            if route=='specialist':
                fd=os.open(request,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,'w') as f:f.write(wire);f.flush();os.fsync(f.fileno())
                argv=(str(self.home/'.local/bin/hermes'),'-p',profile,'chat','--resume',target['session'],'--no-restore-cwd','--query-file',str(request),'--oneshot','--format','stream-json','--max-turns',str(approval['max_turns']),'--run-budget',str(approval['run_budget']))
            else:
                argv=(str(self.home/'.local/bin/herdr'),'agent','prompt',target['pane'],wire,'--wait','--timeout',str(max(1000,(approval['wait_seconds']-2)*1000)))
        except Exception:
            self._settle(task,phase,'blocked',receipt,release=True);raise
        # No exception after this point can authorize retry; the native request may have been sent.
        try:
            def started(metadata):
                receipt.update(metadata);self._links(task,phase,route,target)
                self._settle(task,phase,'child_started',receipt,release=False)
            outcome=self.port.execute(Command(argv,Path(target['cwd']),output,approval['wait_seconds'],contract['synthetic']),started)
            receipt.update({k:v for k,v in outcome.items() if k in ('pid','exit_code','timed_out')})
            if outcome.get('timed_out') or outcome.get('exit_code')!=0:
                self._settle(task,phase,'uncertain',receipt,release=False);return receipt
            proof=self._collect(task,profile,route,target,wire_hash)
            self._links(task,phase,route,target,proof)
            receipt.update({k:v for k,v in proof.items() if k!='text'})
            self._settle(task,phase,'native_reply_collected',receipt,release=True)
            return {**receipt,'text':proof['text']}
        except Exception as error:
            receipt['error_class']=type(error).__name__
            self._settle(task,phase,'uncertain',receipt,release=False);return receipt
    def _collect(self,task,profile,route,target,wire_hash):
        if self._target(task,profile,route)!=target:raise ValueError('target_not_settled_at_original_identity')
        if route=='specialist':return specialist_final(self.home,profile,target['session'],wire_hash)
        return worker_final(self.home,profile,target['session'],wire_hash,teams=self.teams)

    def collect_existing(self,task,profile,route):
        """Explicit result collection; never starts a process, resends, waits, or renews approval."""
        task_id(task)
        if route not in ('specialist','worker') or profile not in TEAMS:raise ValueError('invalid_existing_delivery')
        phase=route+'-'+profile
        row=self.ledger.db.execute('SELECT state,result FROM attempts WHERE task=? AND phase=?',(task,phase)).fetchone()
        claim=self.ledger.db.execute('SELECT target FROM workflow_delivery_claims WHERE task=? AND phase=?',(task,phase)).fetchone()
        if not row or not row[1] or not claim or row[0]=='blocked':raise ValueError('existing_delivery_receipt_required')
        receipt=json.loads(row[1]);target=json.loads(claim[0]);self.source_check()
        if receipt.get('task_id')!=task or receipt.get('phase')!=phase or receipt.get('profile')!=profile:raise ValueError('existing_receipt_binding_mismatch')
        proof=self._collect(task,profile,route,target,receipt['wire_sha256'])
        self._links(task,phase,route,target,proof)
        receipt.update({k:v for k,v in proof.items() if k!='text'})
        self._settle(task,phase,'native_reply_collected',receipt,release=True)
        return {**receipt,'text':proof['text']}
