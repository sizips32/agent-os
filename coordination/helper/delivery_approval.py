"""Read an operator-recorded, exact-phase approval. Never mint or broaden a grant."""
from __future__ import annotations
import hashlib,json,math,os,stat,time
from pathlib import Path
from task_report import task_id
from workflow_ledger import canonical

class ApprovalStore:
    def __init__(self,root:Path):self.root=Path(root)
    def authorize(self,approval_id,expected,*,synthetic):
        task_id(approval_id)
        fd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            info=os.fstat(fd)
            if info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)&0o077:raise PermissionError('approval_directory_not_private')
            leaf=os.open(approval_id+'.json',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
            try:
                info=os.fstat(leaf)
                if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>16384:raise PermissionError('approval_file_not_private')
                raw=os.read(leaf,16385)
            finally:os.close(leaf)
        finally:os.close(fd)
        try:value=json.loads(raw)
        except ValueError:raise PermissionError('approval_record_invalid') from None
        if not isinstance(value,dict) or value.get('schema')!=1 or value.get('decision')!='approved' or value.get('mode')!=('synthetic' if synthetic else 'live'):raise PermissionError('operator_approval_required')
        if value.get('scope')!=expected:raise PermissionError('approval_scope_mismatch')
        expires=value.get('expires_at')
        if type(expires) not in (int,float) or not math.isfinite(expires) or expires<=time.time():raise PermissionError('approval_expired')
        wait=value.get('wait_seconds');turns=value.get('max_turns');budget=value.get('run_budget')
        if type(wait) is not int or not 5<=wait<=180 or type(turns) is not int or not 1<=turns<=10 or type(budget) is not int or not 1<=budget<=150 or budget>wait:raise PermissionError('approval_budget_invalid')
        return {'approval_id':approval_id,'approval_sha256':hashlib.sha256(raw).hexdigest(),'wait_seconds':wait,'max_turns':turns,'run_budget':budget}

class DenyLiveApproval:
    def authorize(self,*args,**kwargs):raise PermissionError('live_operator_approval_integration_not_enabled')
