import copy,hashlib,json,multiprocessing,os,sqlite3,subprocess,sys,tempfile,time,unittest,uuid
from datetime import datetime,timezone,timedelta
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
HELPER=Path(__file__).resolve().parents[1]/'helper'
sys.path.insert(0,str(HELPER))
from task_report import inspect_task,resolve_note,read_owned,readonly_connection
from workflow_routes import Scope,ManagedContext,existing_team_plan,dispatch_live,capture_managed_snapshot,TEAMS
from workflow_ledger import WorkflowLedger
from workflow_review import review_synthetic,require_live_publication_review

def scope(task='synthetic_task',profile='paul',**kw):return Scope(task,(profile,),('plan','synthetic-dispatch'),time.time()+60,True,**kw)
def duplicate_child(dbpath,q):
    ledger=WorkflowLedger(Path(dbpath))
    try:
        ledger.synthetic_run('synthetic_task','worker-paul','paul',scope(),{'x':1},lambda _:q.put('sent') or {'native':'fixture'})
    except ValueError:q.put('duplicate')
    finally:ledger.close()

class Fixtures(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='ohha-synthetic-');self.root=Path(self.temp.name);self.home=self.root/'home';self.state=self.root/'state';self.vault=self.root/'vault'
        self.state.mkdir();(self.vault/'0_INBOX').mkdir(parents=True);(self.vault/'_giselle/OH-HA_Agent_OS/Records').mkdir(parents=True)
        self.ledger=WorkflowLedger(self.state/'ledger.sqlite3');self.task='synthetic_task';self.ledger.register(self.task,'public_research',['specialist-paul','worker-paul','aside'],synthetic=True)
        for profile,(ws,relative) in TEAMS.items():
            p=self.home/'.hermes/profiles'/profile;(p/'runtime').mkdir(parents=True)
            with closing(sqlite3.connect(p/'state.db')) as db,db:db.execute('CREATE TABLE sessions(id TEXT,title TEXT,profile_name TEXT)');db.execute('INSERT INTO sessions VALUES(?,?,?)',('native-'+profile,'Bot Chat',profile))
            (p/'runtime/active_sessions.json').write_text('{"entries":[]}')
        self.snapshot={'synthetic':True,'provenance':'synthetic_fixture','captured_at':time.time(),'agents':[{'workspace_id':ws,'pane_id':ws+':p2','agent':'claude','agent_status':'idle','agent_session':{'value':'worker-'+p},'cwd':str(self.home/relative),'foreground_cwd':str(self.home/relative)} for p,(ws,relative) in TEAMS.items()]}
        self.captures=self.root/'captures';self.captures.mkdir();self.original=b'Synthetic announcement: the fixture rate is 4.25 percent.';(self.captures/'source.txt').write_bytes(self.original)
        quote='the fixture rate is 4.25 percent'
        self.sources=[{'id':'source1','synthetic':True,'url':'https://example.org/synthetic','checked_at':datetime.now(timezone.utc).isoformat(),'path':'source.txt','sha256':hashlib.sha256(self.original).hexdigest()}]
        self.claims=[{'id':'claim1','text':'Synthetic rate equals 4.25 percent.','decision':'supports','reviewer_kind':'synthetic_fixture','evidence':[{'source_id':'source1','excerpt':quote,'excerpt_sha256':hashlib.sha256(quote.encode()).hexdigest()}]}]
    def tearDown(self):self.ledger.close();self.temp.cleanup()
    def review(self):return review_synthetic(self.ledger,self.task,captures=self.sources,claims=self.claims,capture_root=self.captures)
    def traces(self):
        l=self.ledger;t=self.task
        l.link(t,'coordinator',role='coordinator',phase='specialist-paul',session='coordinator-fixture')
        l.link(t,'specialist',role='specialist',phase='specialist-paul',profile='paul',session='native-paul',source_kind='existing_hermes_bot_chat')
        l.link(t,'worker',role='worker',phase='worker-paul',profile='paul',workspace='w2',pane='w2:p2',session='worker-paul',source_kind='existing_herdr_worker')
        l.link(t,'aside',role='aside',phase='aside',aside_session_id='aside-native-fixture')
        l.link(t,'native-result',role='native_result',phase='worker-paul',session='worker-paul',native_final_id='final-fixture',sha256='a'*64)
    def phases(self):
        for phase in ['specialist-paul','worker-paul','aside']:self.ledger.synthetic_run(self.task,phase,'paul',scope(),{'synthetic':True,'phase':phase},lambda _: {'native_final':'fixture-final'})
    def note(self,destination='0_INBOX'):
        name='AgentOS-'+str(uuid.uuid5(uuid.NAMESPACE_URL,'ohha:'+self.task))+'.md';path=self.vault/destination/name;path.write_text('synthetic note only')
        data={'task_id':self.task,'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'artifact':{'verification':'verified','sources':[]}}
        (self.state/(self.task+'-knowledge.json')).write_text(json.dumps(data));return path,data

class RouteTests(Fixtures):
    def test_all_four_original_profiles_and_workers(self):
        for profile,(ws,_) in TEAMS.items():
            with self.subTest(profile=profile):
                plan=existing_team_plan(self.task,profile,scope(profile=profile),self.home,self.snapshot)
                self.assertEqual(plan['specialist']['session'],'native-'+profile);self.assertEqual(plan['worker']['workspace'],ws);self.assertFalse(plan['live_dispatch_enabled']);self.assertEqual(plan['execution'],'plan_only')
    def test_scope_mismatches_expiry_and_nonfinite(self):
        cases=[Scope('wrong',('paul',),('plan',),time.time()+60,True),Scope(self.task,('james',),('plan',),time.time()+60,True),Scope(self.task,('paul',),('send',),time.time()+60,True),Scope(self.task,('paul',),('plan',),0,True),Scope(self.task,('paul',),('plan',),float('nan'),True),Scope(self.task,('paul',),('plan',),time.time()+60,False)]
        for s in cases:
            with self.subTest(scope=s),self.assertRaises(ValueError):existing_team_plan(self.task,'paul',s,self.home,self.snapshot)
    def test_busy_ambiguous_wrong_root_pane_session_and_stale(self):
        mutations=[lambda x:x.update(captured_at=time.time()-31),lambda x:x.update(provenance='guessed'),lambda x:x['agents'].append(copy.deepcopy(x['agents'][0])),lambda x:x['agents'][0].update(agent_status='working'),lambda x:x['agents'][0].update(cwd='/other'),lambda x:x['agents'][0].update(foreground_cwd='/other'),lambda x:x['agents'][0].update(pane_id='w4:p2'),lambda x:x['agents'][0].update(agent_session=None)]
        for change in mutations:
            x=copy.deepcopy(self.snapshot);change(x)
            with self.subTest(change=change),self.assertRaises(ValueError):existing_team_plan(self.task,'paul',scope(),self.home,x)
    def test_busy_original_session_is_not_replaced(self):
        p=self.home/'.hermes/profiles/paul/runtime/active_sessions.json';p.write_text('{"entries":[{"metadata":{"live_session_id":"native-paul"}}]}')
        with self.assertRaisesRegex(ValueError,'busy'):existing_team_plan(self.task,'paul',scope(),self.home,self.snapshot)
    def test_duplicate_bot_chat_is_not_guessed(self):
        with closing(sqlite3.connect(self.home/'.hermes/profiles/paul/state.db')) as db,db:db.execute("INSERT INTO sessions VALUES('other','Bot Chat','paul')")
        with self.assertRaisesRegex(ValueError,'unique'):existing_team_plan(self.task,'paul',scope(),self.home,self.snapshot)
    def test_fake_env_context_never_reaches_native_api(self):
        context=ManagedContext('1','w2','w2:p3','/bin/zsh','/Applications/Agent OS.app/Contents/MacOS/Agent OS')
        with patch('workflow_routes.current_context',return_value=context),patch('workflow_routes.subprocess.run') as native,self.assertRaisesRegex(ValueError,'ownership'):
            capture_managed_snapshot(self.root/'herdr')
        native.assert_not_called()
    def test_context_marker_shell_and_foreground_gate(self):
        binary=self.root/'herdr'
        for c in [ManagedContext(None,'w2','w2:p3','/bin/zsh',str(binary)),ManagedContext('1','w2','w4:p3','/bin/zsh',str(binary)),ManagedContext('1','w2','w2:p3','/bin/python',str(binary))]:
            with self.subTest(context=c),self.assertRaises(ValueError):c.require(binary)
        with patch('workflow_routes.current_context',return_value=ManagedContext('1','w2','w2:p3','/bin/zsh',str(binary))),patch('workflow_routes.os.isatty',return_value=False),patch('workflow_routes.subprocess.run') as native,self.assertRaisesRegex(ValueError,'foreground'):capture_managed_snapshot(binary)
        native.assert_not_called()
    def test_live_dispatch_always_blocked(self):
        with self.assertRaises(PermissionError):dispatch_live()

class LedgerTests(Fixtures):
    def test_duplicate_does_not_call_transport_twice(self):
        sent=[];run=lambda:self.ledger.synthetic_run(self.task,'worker-paul','paul',scope(),{'x':1},lambda _:sent.append(1) or {'native':'fixture'})
        run()
        with self.assertRaisesRegex(ValueError,'never_resend'):run()
        self.assertEqual(sent,[1])
    def test_cross_process_duplicate_sends_once(self):
        ctx=multiprocessing.get_context('spawn');q=ctx.Queue();processes=[ctx.Process(target=duplicate_child,args=(str(self.state/'ledger.sqlite3'),q)) for _ in range(2)]
        for p in processes:p.start()
        for p in processes:p.join(10);self.assertEqual(p.exitcode,0)
        self.assertCountEqual([q.get(timeout=2),q.get(timeout=2)],['sent','duplicate']);q.close()
    def test_uncertain_preserved_and_retry_blocked(self):
        def transport(_):raise TimeoutError('synthetic timeout')
        with self.assertRaises(TimeoutError):self.ledger.synthetic_run(self.task,'worker-paul','paul',scope(),{},transport)
        self.assertEqual(self.ledger.phase_states(self.task)['worker-paul'],'uncertain')
        with self.assertRaisesRegex(ValueError,'never_resend'):self.ledger.synthetic_run(self.task,'worker-paul','paul',scope(),{},lambda _:self.fail('resent'))
    def test_immutable_facts_and_contract(self):
        self.assertTrue(self.ledger.fact(self.task,'transport','example',{'x':1}));self.assertFalse(self.ledger.fact(self.task,'transport','example',{'x':1}))
        with self.assertRaises(ValueError):self.ledger.fact(self.task,'transport','example',{'x':2})
        with self.assertRaises(sqlite3.IntegrityError):self.ledger.db.execute("UPDATE workflow_facts SET payload='{}'")
        with self.assertRaises(ValueError):self.ledger.register(self.task,'local_check',['other'],synthetic=True)
    def test_trace_identity_requirements(self):
        cases=[{'role':'specialist','profile':'paul','session':'new','source_kind':'delegate_task'},{'role':'worker','profile':'paul','session':'worker','workspace':'w4','pane':'w4:p2','source_kind':'existing_herdr_worker'},{'role':'aside'},{'role':'native_result','native_final_id':'final'},{'role':'coordinator','session':'secret text is not an ID'}]
        for i,fields in enumerate(cases):
            with self.subTest(fields=fields),self.assertRaises(ValueError):self.ledger.link(self.task,'bad'+str(i),phase='worker-paul',**fields)
    def test_completion_needs_every_phase_trace_and_review(self):
        review=self.review()
        with self.assertRaisesRegex(ValueError,'phase_unresolved'):self.ledger.complete_synthetic(self.task,review['revision'])
        self.phases()
        with self.assertRaisesRegex(ValueError,'trace_links'):self.ledger.complete_synthetic(self.task,review['revision'])
        self.traces()
        with self.assertRaisesRegex(ValueError,'matching_claim'):self.ledger.complete_synthetic(self.task,'wrong')
        completed=self.ledger.complete_synthetic(self.task,review['revision']);self.assertEqual(completed['verification'],'unverified')
        report=inspect_task(self.task,self.state,self.vault);self.assertEqual(report['computed_verification'],'synthetic_only');self.assertEqual(len(report['links']),5)
    def test_real_task_cannot_use_synthetic_adapter(self):
        self.ledger.register('real_task','local_check',['worker-paul'],synthetic=False)
        with self.assertRaises(PermissionError):self.ledger.synthetic_run('real_task','worker-paul','paul',Scope('real_task',('paul',),('synthetic-dispatch',),time.time()+60,False),{},lambda _:self.fail('real send'))
    def test_legacy_schema_and_raw_results_preserved(self):
        raw=json.dumps({'private_prompt':'not for UI','session':'existing-native','secret':'do-not-return'})
        with self.ledger.db:self.ledger.db.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?)',(self.task,'specialist-paul','h','native_final_received_fact_verification_needed',raw,time.time()))
        report=inspect_task(self.task,self.state,self.vault);self.assertEqual(report['phases'][0]['state'],'native_final_unverified');self.assertNotIn('do-not-return',json.dumps(report));self.assertEqual(self.ledger.db.execute('SELECT result FROM attempts').fetchone()[0],raw)
    def test_missing_transport_receipt_prevents_completion(self):
        self.traces();review=self.review()
        with self.ledger.db:
            for phase in ['specialist-paul','worker-paul','aside']:self.ledger.db.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?)',(self.task,phase,'h','returned_unverified','{}',time.time()))
        with self.assertRaisesRegex(ValueError,'transport_receipt_missing'):self.ledger.complete_synthetic(self.task,review['revision'])
    def test_existing_legacy_task_cannot_be_reclassified_as_synthetic(self):
        with self.ledger.db:self.ledger.db.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?)',('legacy_task','delegate-paul','h','uncertain','{}',time.time()))
        with self.assertRaisesRegex(ValueError,'must_not_be_reclassified'):self.ledger.register('legacy_task','local_check',['worker-paul'],synthetic=True)
        self.assertEqual(self.ledger.phase_states('legacy_task')['delegate-paul'],'uncertain')
    def test_new_verified_note_is_rejected_before_any_write(self):
        import control
        data={'task_id':self.task,'title':'synthetic only','body':'synthetic body','topics':[],'projects':[],'entities':[],'sources':[],'relations':[],'verification':'verified'}
        before=set(self.state.iterdir())
        with self.assertRaises(PermissionError):control.save(data,self.vault,self.state)
        self.assertEqual(list((self.vault/'0_INBOX').iterdir()),[]);self.assertEqual(set(self.state.iterdir()),before)
    def test_cli_cannot_send_specialist(self):
        env={'PATH':'/usr/bin:/bin','HOME':str(self.home)}
        r=subprocess.run([sys.executable,'-B',str(HELPER/'control.py'),'specialist','--task',self.task,'--profile','paul','--prompt','synthetic only'],env=env,capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0);self.assertIn('candidate_live_execution',r.stderr);self.assertFalse((self.home/'.hermes/profiles/giselle').exists())

class SourceTests(Fixtures):
    def test_original_excerpt_review_stays_unverified(self):
        result=self.review();self.assertEqual(result['decision'],'synthetic_pass');self.assertEqual(result['verification'],'unverified');self.assertNotIn('4.25',json.dumps(result));self.assertEqual(result['sources'][0]['sha256'],self.sources[0]['sha256']);self.assertEqual(result['claims'][0]['evidence'][0]['source_id'],result['sources'][0]['source_id'])
    def test_url_and_check_time_without_capture_are_insufficient(self):
        self.sources[0]['path']='missing.txt'
        with self.assertRaises(FileNotFoundError):self.review()
    def test_original_hash_change_fails(self):
        (self.captures/'source.txt').write_text('changed synthetic source')
        with self.assertRaisesRegex(ValueError,'capture_changed'):self.review()
    def test_missing_contradicted_and_fabricated_evidence_fail(self):
        mutations=[lambda c:c[0].update(evidence=[]),lambda c:c[0].update(decision='contradicts'),lambda c:c[0]['evidence'][0].update(excerpt='not in original'),lambda c:c[0]['evidence'][0].update(excerpt_sha256='b'*64),lambda c:c[0].update(reviewer_kind='url_syntax')]
        for change in mutations:
            self.claims=copy.deepcopy(self.claims);old=copy.deepcopy(self.claims);change(self.claims)
            with self.subTest(change=change),self.assertRaises(ValueError):self.review()
            self.claims=old
    def test_source_time_provenance_and_url_checks(self):
        changes=[{'checked_at':(datetime.now(timezone.utc)-timedelta(days=8)).isoformat()},{'checked_at':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()},{'checked_at':'2026-10-19T01:00:00'},{'synthetic':False},{'url':'https://user:secret@example.org/'},{'source_kind':'local-file'}]
        for fields in changes:
            old=copy.deepcopy(self.sources);self.sources[0].update(fields)
            with self.subTest(fields=fields),self.assertRaises(ValueError):self.review()
            self.sources=old
    def test_local_check_supports_local_capture(self):
        self.ledger.register('local_task','local_check',['worker-paul'],synthetic=True);self.sources[0].update(source_kind='local-file');self.sources[0].pop('url')
        r=review_synthetic(self.ledger,'local_task',captures=self.sources,claims=self.claims,capture_root=self.captures);self.assertTrue(r['synthetic'])
    def test_synthetic_data_never_authorizes_verified_publish(self):
        self.review()
        with self.assertRaises(PermissionError):require_live_publication_review(self.task,self.state,{'verification':'verified'})

class PipelineTests(Fixtures):
    def test_two_workflow_kinds_share_task_and_original_native_bindings(self):
        from workflow_pipeline import execute_synthetic_workflow
        for kind in ('local_check','public_research'):
            task='pipeline_'+kind;seen=[]
            def transport(request):
                seen.append(request)
                return {'task_id':task,'synthetic':True,'aside_session_id':'fixture-aside'} if request['phase']=='aside' else {'task_id':task,'synthetic':True,'session':request['expected_session'],'native_final_id':'fixture-final','content':'synthetic final only'}
            result=execute_synthetic_workflow(self.ledger,task=task,kind=kind,profiles=['paul','james'],scope=Scope(task,('paul','james'),('plan','synthetic-dispatch'),time.time()+60,True),home=self.home,snapshot=self.snapshot,coordinator_session='fixture-giselle',transport=transport,captures=self.sources,claims=self.claims,capture_root=self.captures)
            self.assertFalse(result['live_dispatch_enabled']);self.assertEqual(result['completion']['verification'],'unverified');self.assertTrue(all(r['task_id']==task for r in seen));self.assertEqual(len(seen),4+(kind=='public_research'))
            report=inspect_task(task,self.state,self.vault);self.assertEqual(report['computed_verification'],'synthetic_only');self.assertTrue(any(v.get('session')=='native-james' for v in report['links']))
    def test_wrong_native_receipt_becomes_uncertain_and_is_never_resent(self):
        from workflow_pipeline import execute_synthetic_workflow
        task='pipeline_wrong_receipt';sent=[]
        def transport(request):sent.append(request);return {'task_id':task,'synthetic':True,'session':'unrelated-session','native_final_id':'fixture-final','content':'synthetic'}
        kwargs=dict(ledger=self.ledger,task=task,kind='local_check',profiles=['paul'],scope=Scope(task,('paul',),('plan','synthetic-dispatch'),time.time()+60,True),home=self.home,snapshot=self.snapshot,coordinator_session='fixture-giselle',transport=transport,captures=self.sources,claims=self.claims,capture_root=self.captures)
        with self.assertRaisesRegex(ValueError,'binding_mismatch'):execute_synthetic_workflow(**kwargs)
        self.assertEqual(self.ledger.phase_states(task)['specialist-paul'],'uncertain')
        with self.assertRaisesRegex(ValueError,'never_resend'):execute_synthetic_workflow(**kwargs)
        self.assertEqual(len(sent),1)

class ResolverTests(Fixtures):
    def test_absent_state_lookup_creates_nothing(self):
        missing=self.root/'not-created';report=inspect_task('absent',missing,self.vault)
        self.assertFalse(missing.exists());self.assertEqual(report['note']['status'],'not_found')
    def test_move_resolves_hash_without_changing_history_or_index(self):
        path,data=self.note();idx=self.state/(self.task+'-knowledge.json');before=idx.read_bytes();history='old reply path: '+str(path);destination=self.vault/'_giselle/OH-HA_Agent_OS/Records'/path.name;path.rename(destination)
        r=resolve_note(self.task,self.state,self.vault);self.assertEqual(r['status'],'moved');self.assertTrue(r['hash_matches']);self.assertEqual(idx.read_bytes(),before);self.assertIn('0_INBOX',history);self.assertEqual(inspect_task(self.task,self.state,self.vault)['computed_verification'],'unverified')
    def test_changed_duplicate_missing_files_fail_closed(self):
        path,_=self.note();destination=self.vault/'_giselle/OH-HA_Agent_OS/Records'/path.name;destination.write_bytes(path.read_bytes());self.assertEqual(resolve_note(self.task,self.state,self.vault)['status'],'ambiguous')
        destination.write_text('changed');self.assertEqual(resolve_note(self.task,self.state,self.vault)['status'],'changed');destination.unlink();path.unlink();self.assertEqual(resolve_note(self.task,self.state,self.vault)['status'],'missing')
    def test_symlinks_traversal_and_arbitrary_paths_refused(self):
        path,data=self.note();raw=path.read_bytes();path.unlink();other=self.root/'unrelated.md';other.write_bytes(raw);path.symlink_to(other);self.assertEqual(resolve_note(self.task,self.state,self.vault)['status'],'unsafe_note')
        for value in ['../other','/absolute','_giselle/../other','./source']:
            with self.subTest(value=value),self.assertRaises(ValueError):read_owned(self.vault,value)
        data['path']=str(other);(self.state/(self.task+'-knowledge.json')).write_text(json.dumps(data));self.assertEqual(resolve_note(self.task,self.state,self.vault)['status'],'unsafe_record')
        with self.assertRaises(ValueError):inspect_task('../secret',self.state,self.vault)
    def test_query_is_readonly_and_does_not_write_db(self):
        self.note();path=self.state/'ledger.sqlite3';before=path.read_bytes();files=set(self.state.iterdir());db=readonly_connection(path)
        with self.assertRaises(sqlite3.OperationalError):db.execute("DELETE FROM attempts")
        db.close();inspect_task(self.task,self.state,self.vault);self.assertEqual(path.read_bytes(),before);self.assertEqual(set(self.state.iterdir()),files)
    def test_bundled_reader_matches_helper_and_stays_isolated(self):
        self.note();reader=HELPER.parents[1]/'apps/desktop/protected/task-inspect.py'
        r=subprocess.run([sys.executable,'-I','-B',str(reader),'--task',self.task,'--state',str(self.state),'--vault',str(self.vault)],capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(r.stdout),inspect_task(self.task,self.state,self.vault))

if __name__=='__main__':unittest.main(verbosity=2)
