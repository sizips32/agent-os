import hashlib,json,os,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'helper'))
from operator_approval import ApprovalIssuer
from delivery_approval import ApprovalStore
from workflow_ledger import canonical
class OperatorReviewTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)/'approvals';self.root.mkdir(mode=0o700);self.scope={'task':'fixture_task','phase':'specialist-paul','route':'specialist-resume','profile':'paul','session':'fixture_native','cwd':'/fixture/project','prompt_sha256':'a'*64}
 def approve(self,p):return {'decision':'approved','proposal_sha256':hashlib.sha256(canonical(p).encode()).hexdigest()}
 def test_reviewed_exact_scope_is_readable_by_existing_store(self):
  r=ApprovalIssuer(self.root,self.approve).issue(self.scope,synthetic=True);record=ApprovalStore(self.root).authorize(r['approval_id'],self.scope,synthetic=True);self.assertEqual(record['max_turns'],3);self.assertEqual((self.root/(r['approval_id']+'.json')).stat().st_mode&0o777,0o600)
 def test_denied_review_does_not_write_any_receipt(self):
  for value in [None,True,{'decision':'approved'},{'decision':'approved','proposal_sha256':'0'*64},{'decision':'denied'}]:
   with self.assertRaises(PermissionError):ApprovalIssuer(self.root,lambda _:value).issue(self.scope,synthetic=True)
  self.assertEqual(list(self.root.iterdir()),[])
 def test_scope_copy_cannot_be_broadened_by_review_port(self):
  def change(p):p['scope']['session']='other';return self.approve(p)
  with self.assertRaises(PermissionError):ApprovalIssuer(self.root,change).issue(self.scope,synthetic=True)
  self.assertEqual(self.scope['session'],'fixture_native');self.assertEqual(list(self.root.iterdir()),[])
 def test_new_grant_never_overwrites_older_grants(self):
  issuer=ApprovalIssuer(self.root,self.approve);a=issuer.issue(self.scope,synthetic=True);before=(self.root/(a['approval_id']+'.json')).read_bytes();b=issuer.issue(self.scope,synthetic=True);self.assertNotEqual(a['approval_id'],b['approval_id']);self.assertEqual((self.root/(a['approval_id']+'.json')).read_bytes(),before)
 def test_wide_budgets_and_extra_scope_are_rejected_before_review(self):
  def never(_):self.fail('must not review invalid scope')
  for kw in [{'run_budget':151},{'wait_seconds':181},{'max_turns':11},{'lifetime':301}]:
   with self.assertRaises(ValueError):ApprovalIssuer(self.root,never).issue(self.scope,synthetic=True,**kw)
  with self.assertRaises(ValueError):ApprovalIssuer(self.root,never).issue({**self.scope,'extra':'broad'},synthetic=True)
 def test_symlink_or_public_directory_never_receives_grants(self):
  link=self.root.parent/'link';link.symlink_to(self.root)
  with self.assertRaises(PermissionError):ApprovalIssuer(link,self.approve).issue(self.scope,synthetic=True)
  self.root.chmod(0o755)
  with self.assertRaises(PermissionError):ApprovalIssuer(self.root,self.approve).issue(self.scope,synthetic=True)
 def test_real_and_synthetic_receipts_cannot_cross_modes(self):
  r=ApprovalIssuer(self.root,self.approve).issue(self.scope,synthetic=True)
  with self.assertRaises(PermissionError):ApprovalStore(self.root).authorize(r['approval_id'],self.scope,synthetic=False)
 def test_default_review_port_is_unavailable(self):
  with self.assertRaises(ValueError):ApprovalIssuer(self.root,None)
if __name__=='__main__':unittest.main()
