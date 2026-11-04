"""Every native process is replaced by a fake. No live dispatch or model execution."""
import copy,hashlib,json,os,re,sqlite3,sys,time,unittest
from pathlib import Path
from contextlib import closing
from unittest.mock import patch
from test_workflow import Fixtures,HELPER
from workflow_ledger import WorkflowLedger
from delivery_adapter import DeliveryService,NativeProcessPort,Command
from delivery_approval import ApprovalStore

class FakePort:
    synthetic=True
    def __init__(self,callback):self.calls=[];self.callback=callback
    def execute(self,command,started=None):
        self.calls.append(command)
        if started:started({'pid':900001})
        return self.callback(command)

class DeliveryTests(Fixtures):
    def setUp(self):
        super().setUp();self.guard=patch('delivery_adapter.subprocess.Popen',side_effect=AssertionError('native process must never be launched by synthetic tests'));self.guard.start();self.addCleanup(self.guard.stop)
        from workflow_routes import TEAMS
        for _,relative in TEAMS.values():(self.home/relative).mkdir(parents=True,exist_ok=True)
        self.grants=self.state/'operator-approvals';self.grants.mkdir(mode=0o700);self.store=ApprovalStore(self.grants)
        for profile in ('paul','james'):
            with closing(sqlite3.connect(self.home/'.hermes/profiles'/profile/'state.db')) as db,db:db.execute('CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,tool_calls TEXT)')
        root=self.home/'.claude/projects'/re.sub(r'[^A-Za-z0-9]','-',str(self.home/'projects/paul'));root.mkdir(parents=True)
        self.transcript=root/'worker-paul.jsonl';self.transcript.write_text(json.dumps({'type':'user','uuid':'old-user','cwd':str(self.home/'projects/paul'),'message':{'content':'old synthetic request'}})+'\n')
        self.snap=lambda:{**copy.deepcopy(self.snapshot),'captured_at':time.time()}
        self.port=FakePort(self.final_receipt)
        self.service=DeliveryService(self.ledger,self.home,self.state,approvals=self.store,port=self.port,snapshot=self.snap,source_check=lambda:None)
        self.prompt='Synthetic instruction only; no external calls.'
    def final_receipt(self,command):
        if command.argv[1]=='-p':
            wire=Path(command.argv[command.argv.index('--query-file')+1]).read_text();sid=command.argv[command.argv.index('--resume')+1];profile=command.argv[2]
            with closing(sqlite3.connect(self.home/'.hermes/profiles'/profile/'state.db')) as db,db:
                db.execute('INSERT INTO messages(session_id,role,content) VALUES(?,?,?)',(sid,'user',wire));db.execute('INSERT INTO messages(session_id,role,content) VALUES(?,?,?)',(sid,'assistant','synthetic native final'))
        else:
            wire=command.argv[4]
            with self.transcript.open('a') as f:
                for row in [{'type':'user','uuid':'new-user','cwd':str(command.cwd),'message':{'content':wire}},{'type':'assistant','uuid':'new-final','message':{'content':[{'type':'text','text':'synthetic native final'}],'stop_reason':'end_turn'}}]:f.write(json.dumps(row)+'\n')
        return {'pid':900001,'exit_code':0,'timed_out':False}
    def grant(self,route='specialist',task=None,profile='paul',identity='approved',mutate=None):
        task=task or self.task;phase=route+'-'+profile;target=self.service._target(task,profile,route);wire=self.service._wire(task,phase,self.prompt)
        value={'schema':1,'decision':'approved','mode':'synthetic','expires_at':time.time()+60,'wait_seconds':45,'max_turns':3,'run_budget':30,'scope':{'task':task,'phase':phase,**target,'prompt_sha256':hashlib.sha256(wire.encode()).hexdigest()}}
        if mutate:mutate(value)
        p=self.grants/(identity+'.json');p.write_text(json.dumps(value));p.chmod(0o600);return identity
    def run_delivery(self,route='specialist',approval_id='approved',task=None):return self.service.dispatch(task or self.task,'paul',route,self.prompt,approval_id)
    def test_original_specialist_resume_and_native_receipt(self):
        self.grant();result=self.run_delivery();argv=self.port.calls[0].argv
        self.assertEqual(argv[:7],(str(self.home/'.local/bin/hermes'),'-p','paul','chat','--resume','native-paul','--no-restore-cwd'));self.assertIn('--oneshot',argv);self.assertNotIn('--new',argv);self.assertEqual(result['state'],'native_reply_collected');self.assertEqual(result['session'],'native-paul');self.assertEqual(result['verification'],'unverified');self.assertIn('native_final_id',result);self.assertNotIn('text',json.loads(self.ledger.db.execute('SELECT result FROM attempts').fetchone()[0]))
        with self.assertRaises(ValueError):self.run_delivery()
        self.assertEqual(len(self.port.calls),1)
    def test_documented_worker_prompt_keeps_exact_pane_and_original_session(self):
        self.grant('worker');result=self.run_delivery('worker');command=self.port.calls[0]
        self.assertEqual(command.argv[:4],(str(self.home/'.local/bin/herdr'),'agent','prompt','w2:p2'));self.assertEqual(command.argv[-3:],('--wait','--timeout','43000'));self.assertEqual(result['session'],'worker-paul');self.assertEqual(result['native_user_id'],'new-user');self.assertEqual(result['native_final_id'],'new-final');self.assertEqual(result['state'],'native_reply_collected')
    def test_explicit_owner_project_binding_is_used_for_worker_and_native_result(self):
        from workflow_routes import TEAMS
        root=self.home/'owner-projects/paul';root.mkdir(parents=True)
        project=self.home/'.claude/projects'/re.sub(r'[^A-Za-z0-9]','-',str(root));project.mkdir()
        transcript=project/'worker-paul.jsonl';self.transcript.rename(transcript);self.transcript=transcript
        self.snapshot['agents'][0].update(cwd=str(root),foreground_cwd=str(root))
        self.service.teams={**TEAMS,'paul':('w2','owner-projects/paul')}
        self.grant('worker');result=self.run_delivery('worker')
        self.assertEqual(self.port.calls[0].cwd,root);self.assertEqual(result['state'],'native_reply_collected')
    def test_scope_mismatch_and_expiry_never_reserve_or_launch(self):
        mutations=[lambda v:v['scope'].update(task='other'),lambda v:v['scope'].update(session='other'),lambda v:v['scope'].update(prompt_sha256='a'*64),lambda v:v.update(expires_at=0),lambda v:v.update(mode='live'),lambda v:v.update(run_budget=151),lambda v:v['scope'].update(route='delegate_task')]
        for i,change in enumerate(mutations):
            approval=self.grant(identity='bad'+str(i),mutate=change)
            with self.subTest(i=i),self.assertRaises(PermissionError):self.run_delivery(approval_id=approval)
        self.assertFalse(self.port.calls);self.assertEqual(self.ledger.phase_states(self.task),{})
    def test_approval_symlink_and_nonprivate_permissions_fail(self):
        self.grant();p=self.grants/'approved.json';p.chmod(0o644)
        with self.assertRaises(PermissionError):self.run_delivery()
        p.chmod(0o600);p.rename(self.grants/'real.json');p.symlink_to(self.grants/'real.json')
        with self.assertRaises(OSError):self.run_delivery()
        self.assertFalse(self.port.calls)
    def test_default_live_gate_denies_before_any_native_discovery(self):
        self.service.approvals=__import__('delivery_approval').DenyLiveApproval();self.service.snapshot=lambda:self.fail('native snapshot should not run')
        with self.assertRaises(PermissionError):self.run_delivery()
        self.assertFalse(self.port.calls)
    def test_synthetic_command_cannot_reach_real_process_port(self):
        with self.assertRaises(PermissionError):NativeProcessPort().execute(Command(('never',),self.root,self.root/'out',5,True))
    def test_interface_change_refuses_before_reservation(self):
        self.grant();self.service.source_check=lambda:(_ for _ in ()).throw(ValueError('native_interface_changed'))
        with self.assertRaisesRegex(ValueError,'interface_changed'):self.run_delivery()
        self.assertFalse(self.port.calls);self.assertEqual(self.ledger.phase_states(self.task),{})
    def test_session_replacement_between_reads_blocks_delivery(self):
        self.grant('worker');calls=0
        def snapshot():
            nonlocal calls
            calls+=1;s=self.snap()
            if calls==2:s['agents'][0]['agent_session']['value']='replacement-session'
            return s
        self.service.snapshot=snapshot
        with self.assertRaises((ValueError,FileNotFoundError)):self.run_delivery('worker')
        self.assertFalse(self.port.calls);self.assertEqual(self.ledger.phase_states(self.task)['worker-paul'],'blocked')
    def test_busy_or_unsupported_worker_never_receives_input(self):
        self.grant('worker')
        for change in [{'agent_status':'working'},{'agent':'codex'},{'cwd':'/other'}]:
            self.service.snapshot=lambda change=change:{**self.snap(),'agents':[{**self.snapshot['agents'][0],**change}]}
            with self.assertRaises(ValueError):self.run_delivery('worker')
        self.assertFalse(self.port.calls)
    def test_timeout_keeps_reservation_claim_and_never_resends_even_under_new_task(self):
        self.grant('worker');self.port.callback=lambda _: {'pid':900001,'exit_code':None,'timed_out':True}
        result=self.run_delivery('worker');self.assertEqual(result['state'],'uncertain')
        with self.assertRaisesRegex(ValueError,'never_resend'):self.run_delivery('worker')
        self.ledger.register('next_task','local_check',['worker-paul'],synthetic=True);self.snapshot['agents'][0]['pane_id']='w2:p9';self.grant('worker',task='next_task',identity='next')
        with self.assertRaisesRegex(ValueError,'target_owned'):self.run_delivery('worker',approval_id='next',task='next_task')
        self.assertEqual(len(self.port.calls),1);self.assertEqual(self.ledger.db.execute('SELECT active FROM workflow_delivery_claims').fetchone()[0],1)
    def test_nonzero_client_exit_or_missing_native_final_is_not_success(self):
        for task,callback in [('bad_exit',lambda _:{'pid':9,'exit_code':1,'timed_out':False}),('missing_final',lambda _:{'pid':9,'exit_code':0,'timed_out':False})]:
            # Separate specialist profiles avoid a deliberate outstanding target claim.
            profile='paul' if task=='bad_exit' else 'james';self.ledger.register(task,'local_check',['specialist-'+profile],synthetic=True);self.grant(task=task,profile=profile,identity=task);self.port.callback=callback
            result=self.service.dispatch(task,profile,'specialist',self.prompt,task);self.assertEqual(result['state'],'uncertain')
    def test_transport_exception_is_uncertain_without_automatic_recovery(self):
        self.grant();self.port.callback=lambda _:(_ for _ in ()).throw(OSError('synthetic launch failure'))
        result=self.run_delivery();self.assertEqual(result['state'],'uncertain');self.assertEqual(result['error_class'],'OSError')
        with self.assertRaisesRegex(ValueError,'never_resend'):self.run_delivery()
        self.assertEqual(len(self.port.calls),1)
    def test_native_request_without_ledger_receipt_is_not_duplicated(self):
        self.grant('worker');wire=self.service._wire(self.task,'worker-paul',self.prompt)
        with self.transcript.open('a') as f:f.write(json.dumps({'type':'user','uuid':'orphan-user','cwd':str(self.home/'projects/paul'),'message':{'content':wire}})+'\n')
        with self.assertRaisesRegex(ValueError,'already_exists'):self.run_delivery('worker')
        self.assertFalse(self.port.calls)
    def test_adapter_backed_local_workflow_completes_only_as_synthetic(self):
        from workflow_review import review_synthetic
        task='adapter_local';self.ledger.register(task,'local_check',['specialist-paul','worker-paul'],synthetic=True)
        self.ledger.link(task,'coordinator',role='coordinator',phase='specialist-paul',session='fixture-giselle')
        for route in ('specialist','worker'):
            self.grant(route,task=task,identity=route);self.run_delivery(route,task=task,approval_id=route)
        review=review_synthetic(self.ledger,task,captures=self.sources,claims=self.claims,capture_root=self.captures)
        final=self.ledger.complete_synthetic(task,review['revision']);self.assertEqual(final['verification'],'unverified');self.assertEqual(final['decision'],'synthetic_complete_only');self.assertEqual(len(self.port.calls),2)
    def test_timeout_can_collect_later_without_sending_or_renewing_approval(self):
        self.grant('worker');self.port.callback=lambda _: {'pid':900001,'exit_code':None,'timed_out':True};self.run_delivery('worker')
        command=self.port.calls[0];self.final_receipt(command)
        (self.grants/'approved.json').unlink()
        result=self.service.collect_existing(self.task,'paul','worker')
        self.assertEqual(result['state'],'native_reply_collected');self.assertEqual(len(self.port.calls),1);self.assertEqual(self.ledger.db.execute('SELECT active FROM workflow_delivery_claims').fetchone()[0],0)
    def test_running_process_id_is_persisted_before_native_wait(self):
        self.grant()
        def inspect(command):
            state,raw=self.ledger.db.execute('SELECT state,result FROM attempts').fetchone()
            self.assertEqual(state,'child_started');self.assertEqual(json.loads(raw)['pid'],900001)
            return self.final_receipt(command)
        self.port.callback=inspect;self.run_delivery()
    def test_native_process_timeout_never_terminates_the_agent_or_retries(self):
        import subprocess
        class Child:
            pid=999001
            def wait(self,timeout):raise subprocess.TimeoutExpired('synthetic-native-client',timeout)
            def kill(self):raise AssertionError('must not kill')
            def terminate(self):raise AssertionError('must not terminate')
        calls=[]
        def spawn(*args,**kwargs):calls.append((args,kwargs));return Child()
        with patch('delivery_adapter.subprocess.Popen',side_effect=spawn):
            port=NativeProcessPort();result=port.execute(Command(('synthetic-executable',),self.root,self.root/'fake-client-output',5,False))
        self.assertTrue(result['timed_out']);self.assertEqual(len(calls),1);self.assertIn(999001,port.children)
    def test_exact_link_schema_excludes_implementation_locals(self):
        self.grant('worker');self.run_delivery('worker')
        rows=self.ledger.db.execute("SELECT payload FROM workflow_facts WHERE kind='link'").fetchall()
        for (raw,) in rows:self.assertTrue(set(json.loads(raw))<={'role','phase','profile','workspace','pane','session','native_user_id','native_final_id','aside_session_id','sha256','source_kind'})
    def test_literal_prompt_is_data_in_the_existing_query_file_path(self):
        self.prompt='Synthetic literals: $(never_execute) `never_execute` ; <not-a-command>'
        self.grant();result=self.run_delivery();self.assertEqual(result['state'],'native_reply_collected')
        command=self.port.calls[0];self.assertIn(self.prompt,Path(command.argv[command.argv.index('--query-file')+1]).read_text())
        self.assertEqual(command.cwd,self.home/'projects/paul')
    def test_post_collection_persistence_failure_keeps_target_claim(self):
        self.grant();original=self.ledger.fact
        def persist(task,kind,identity,payload):
            if kind=='transport' and identity.endswith('-native_reply_collected'):raise OSError('synthetic disk failure')
            return original(task,kind,identity,payload)
        self.ledger.fact=persist
        result=self.run_delivery();self.assertEqual(result['state'],'uncertain');self.assertEqual(self.ledger.db.execute('SELECT active FROM workflow_delivery_claims').fetchone()[0],1)
        with self.assertRaises(ValueError):self.run_delivery()
        self.assertEqual(len(self.port.calls),1)
    def test_changed_approval_budget_is_not_silently_reused(self):
        self.grant();original=self.service._target;calls=0
        def target(*args):
            nonlocal calls
            calls+=1
            if calls==2:
                p=self.grants/'approved.json';value=json.loads(p.read_text());value['max_turns']=1;p.write_text(json.dumps(value))
            return original(*args)
        self.service._target=target
        with self.assertRaisesRegex(ValueError,'approval_changed'):self.run_delivery()
        self.assertFalse(self.port.calls)
    def test_grant_is_rechecked_before_send(self):
        self.grant();original=self.service._target;calls=0
        def target(*args):
            nonlocal calls
            calls+=1
            if calls==2:(self.grants/'approved.json').unlink()
            return original(*args)
        self.service._target=target
        with self.assertRaises(FileNotFoundError):self.run_delivery()
        self.assertFalse(self.port.calls);self.assertEqual(self.ledger.phase_states(self.task)['specialist-paul'],'blocked')

if __name__=='__main__':unittest.main(verbosity=2)
