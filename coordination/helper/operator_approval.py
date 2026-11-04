"""Exact-scope owner review port. No CLI, default reviewer, transport or registration."""
from __future__ import annotations
import hashlib,json,math,os,re,stat,time,uuid
from pathlib import Path
from task_report import task_id
from workflow_ledger import canonical

class ApprovalIssuer:
    def __init__(self,root:Path,review,*,clock=time.time):
        if not callable(review):raise ValueError('trusted_review_port_required')
        self.root=Path(root);self.review=review;self.clock=clock
    def issue(self,scope,*,synthetic,wait_seconds=45,max_turns=3,run_budget=30,lifetime=120):
        if not isinstance(scope,dict) or type(synthetic) is not bool:raise ValueError('exact_scope_required')
        required={'task','phase','route','profile','session','cwd','prompt_sha256'}
        worker={'workspace','pane','kind'}
        route=scope.get('route');allowed=required|(worker if route=='herdr-agent-prompt' else set())
        if set(scope)!=allowed or route not in ('specialist-resume','herdr-agent-prompt'):raise ValueError('exact_scope_required')
        for key in ['task','phase','session']:task_id(scope[key])
        if scope['profile'] not in ('paul','james','jarvis','atelier') or not Path(scope['cwd']).is_absolute():raise ValueError('invalid_target')
        if not re.fullmatch(r'[a-f0-9]{64}',scope['prompt_sha256']):raise ValueError('invalid_prompt_hash')
        if worker<=set(scope):
            if scope['kind']!='claude' or not re.fullmatch(r'w[0-9]+',scope['workspace']) or not re.fullmatch(re.escape(scope['workspace'])+r':p[A-Za-z0-9]+',scope['pane']):raise ValueError('invalid_target')
        if type(wait_seconds) is not int or not 5<=wait_seconds<=180 or type(max_turns) is not int or not 1<=max_turns<=10 or type(run_budget) is not int or not 1<=run_budget<=min(150,wait_seconds) or type(lifetime) not in (int,float) or not math.isfinite(lifetime) or not 1<=lifetime<=300:raise ValueError('invalid_budget')
        # Freeze scope before asking. The port receives a copy; mutation cannot broaden a grant.
        frozen=json.loads(canonical(scope));proposal={"scope":frozen,"synthetic":synthetic,"wait_seconds":wait_seconds,"max_turns":max_turns,"run_budget":run_budget,"lifetime":lifetime}
        digest=hashlib.sha256(canonical(proposal).encode()).hexdigest();reviewed_at=self.clock()
        decision=self.review(json.loads(canonical(proposal)))
        if decision!={'decision':'approved','proposal_sha256':digest}:raise PermissionError('explicit_owner_review_required')
        if self.clock()-reviewed_at>lifetime or self.clock()<reviewed_at:raise PermissionError('owner_review_expired')
        if self.root.is_symlink() or not self.root.is_dir():raise PermissionError('existing_private_approval_directory_required')
        fd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            info=os.fstat(fd)
            if info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700:raise PermissionError('approval_directory_not_private')
            identity=uuid.uuid4().hex
            issued_at=self.clock()
            record={'schema':1,'decision':'approved','mode':'synthetic' if synthetic else 'live','scope':frozen,'issued_at':issued_at,'lifetime':lifetime,'expires_at':issued_at+lifetime,'wait_seconds':wait_seconds,'max_turns':max_turns,'run_budget':run_budget,'reviewed_proposal_sha256':digest}
            leaf=os.open(identity+'.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
            try:
                with os.fdopen(leaf,'w',closefd=False) as f:f.write(canonical(record));f.flush();os.fsync(leaf)
            finally:os.close(leaf)
            os.fsync(fd);return {'approval_id':identity,'proposal_sha256':digest,'expires_at':record['expires_at']}
        finally:os.close(fd)
