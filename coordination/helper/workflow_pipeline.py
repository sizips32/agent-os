"""Candidate orchestration, with an injected synthetic transport and no live adapter."""
from __future__ import annotations
import hashlib
from workflow_ledger import canonical
from workflow_routes import existing_team_plan
from workflow_review import review_synthetic

def execute_synthetic_workflow(ledger,*,task,kind,profiles,scope,home,snapshot,coordinator_session,transport,captures,claims,capture_root):
    if snapshot.get('synthetic') is not True or scope.synthetic is not True:raise PermissionError('synthetic_workflow_only')
    if kind not in ('local_check','public_research') or not profiles or len(set(profiles))!=len(profiles):raise ValueError('invalid_workflow_request')
    # Resolve all original identities before committing or contacting any fixture transport.
    plans=[existing_team_plan(task,p,scope,home,snapshot) for p in profiles]
    phases=[phase for p in profiles for phase in ('specialist-'+p,'worker-'+p)]
    if kind=='public_research':phases.append('aside')
    ledger.register(task,kind,phases,synthetic=True)
    ledger.link(task,'coordinator',role='coordinator',phase=phases[0],session=coordinator_session)
    for plan in plans:
        profile=plan['specialist']['profile']
        for role in ('specialist','worker'):
            binding=plan[role];phase=role+'-'+profile
            request={'task_id':task,'phase':phase,'synthetic':True,'expected_session':binding['session'],'profile':profile}
            def receive(req):
                receipt=transport(req)
                if not isinstance(receipt,dict) or receipt.get('task_id')!=task or receipt.get('session')!=binding['session'] or not receipt.get('native_final_id') or receipt.get('synthetic') is not True:raise ValueError('native_receipt_binding_mismatch')
                # Synthetic content is hashed and kept out of task report/UI.
                if not isinstance(receipt.get('content'),str) or len(receipt['content'])>16000:raise ValueError('bounded_native_final_required')
                return receipt
            receipt=ledger.synthetic_run(task,phase,profile,scope,request,receive)
            ledger.link(task,phase,role=role,phase=phase,profile=profile,session=binding['session'],source_kind=binding['source_kind'],**({'workspace':binding['workspace'],'pane':binding['pane']} if role=='worker' else {}))
            ledger.link(task,'final-'+phase,role='native_result',phase=phase,profile=profile,session=binding['session'],native_final_id=receipt['native_final_id'],sha256=hashlib.sha256(receipt['content'].encode()).hexdigest())
    if kind=='public_research':
        def receive_aside(request):
            receipt=transport(request)
            if not isinstance(receipt,dict) or receipt.get('task_id')!=task or receipt.get('synthetic') is not True or not receipt.get('aside_session_id'):raise ValueError('aside_receipt_binding_mismatch')
            return receipt
        receipt=ledger.synthetic_run(task,'aside',profiles[0],scope,{'task_id':task,'phase':'aside','synthetic':True},receive_aside)
        ledger.link(task,'aside',role='aside',phase='aside',aside_session_id=receipt['aside_session_id'])
    review=review_synthetic(ledger,task,captures=captures,claims=claims,capture_root=capture_root)
    completion=ledger.complete_synthetic(task,review['revision'])
    return {'task_id':task,'plans':plans,'completion':completion,'live_dispatch_enabled':False}
