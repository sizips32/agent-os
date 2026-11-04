import json,plistlib,tempfile,unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from service_preflight import inspect_launch_agent,wait_for_server,reconcile_summary
class PreflightTests(unittest.TestCase):
 def test_missing_legacy_source_is_blocked_without_creating_it(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=root/'service.plist';config={'Label':'fixture.webui','ProgramArguments':['/usr/bin/python3','server.py'],'WorkingDirectory':str(root/'missing'),'EnvironmentVariables':{'API_TOKEN':'synthetic-private'}};p.write_bytes(plistlib.dumps(config));before=p.read_bytes();r=inspect_launch_agent(p)
   self.assertEqual(r['issues'],['working_directory_missing','entrypoint_missing']);self.assertFalse(r['configured']);self.assertFalse(r['runtime_verified']);self.assertEqual(p.read_bytes(),before);self.assertFalse((root/'missing').exists());self.assertNotIn('synthetic-private',json.dumps(r))
 def test_existing_source_does_not_claim_runtime_or_dependency_success(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'server.py').write_text('not executed');p=root/'service.plist';p.write_bytes(plistlib.dumps({'Label':'fixture','ProgramArguments':['/usr/bin/python3','server.py'],'WorkingDirectory':str(root)}));r=inspect_launch_agent(p);self.assertTrue(r['configured']);self.assertFalse(r['runtime_verified']);self.assertEqual(r['action_taken'],'none')
 def test_symlinked_contract_is_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'real').write_text('private');(root/'link').symlink_to(root/'real')
   with self.assertRaises(ValueError):inspect_launch_agent(root/'link')
 def test_slow_server_is_read_not_restarted_or_replayed(self):
  t=[0];budgets=[]
  def status(budget):budgets.append(budget);return t[0]>=125
  r=wait_for_server(status,clock=lambda:t[0],sleep=lambda n:t.__setitem__(0,t[0]+n));self.assertTrue(r['ready']);self.assertEqual(t[0],125);self.assertTrue(all(0<b<=5 for b in budgets));self.assertEqual(r['action_taken'],'none')
 def test_timeout_reports_stage_and_does_not_extend_budget(self):
  t=[0];r=wait_for_server(lambda _:False,timeout=3,clock=lambda:t[0],sleep=lambda n:t.__setitem__(0,t[0]+n));self.assertFalse(r['ready']);self.assertEqual(r['stage'],'waiting_server');self.assertEqual(t[0],3)
 def test_working_agent_is_preserved_but_never_called_ready_or_complete(self):
  r=reconcile_summary([{'ready':True},{'process_running':True,'native_status':'working'}]);self.assertTrue(r['initialized']);self.assertFalse(r['all_ready_for_new_work']);self.assertFalse(r['task_completion_verified']);self.assertEqual(r['working_preserved_count'],1)
 def test_unknown_blocked_missing_remain_incomplete(self):
  for row in [{'process_running':True},{'process_running':True,'native_status':'blocked'},{}]:
   r=reconcile_summary([row]);self.assertFalse(r['initialized']);self.assertEqual(r['attention_count'],1);self.assertFalse(r['task_completion_verified'])
if __name__=='__main__':unittest.main()
