"""Checks original captures and per-claim reviews; URL syntax is never a verdict."""
from __future__ import annotations
from datetime import datetime,timezone
import hashlib,re
from pathlib import Path
from urllib.parse import urlsplit
from task_report import read_owned,task_id,SHA
from workflow_ledger import canonical

def source_url(value):
    if not isinstance(value,str) or len(value)>1000:raise ValueError('invalid_source_url')
    u=urlsplit(value)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or any(c.isspace() for c in value):raise ValueError('clean_https_source_required')
    return value

def checked_time(value):
    try:t=datetime.fromisoformat(value.replace('Z','+00:00'))
    except (ValueError,AttributeError,TypeError):raise ValueError('invalid_check_time') from None
    if t.tzinfo is None:raise ValueError('timezone_required')
    age=(datetime.now(timezone.utc)-t).total_seconds()
    if age < -300 or age > 7*86400:raise ValueError('source_review_stale_or_future')
    return t

def review_synthetic(ledger,task,*,captures,claims,capture_root:Path):
    contract=ledger.contract(task)
    if not contract['synthetic']:raise PermissionError('live_review_not_authorized_in_this_candidate')
    if not isinstance(captures,list) or not captures or len(captures)>20:raise ValueError('source_captures_required')
    sources={};source_records=[]
    for capture in captures:
        identity=task_id(capture['id'])
        if identity in sources or capture.get('synthetic') is not True:raise ValueError('capture_provenance_mismatch')
        source_kind=capture.get('source_kind','public-page')
        if contract['kind']=='public_research' and source_kind!='public-page':raise ValueError('public_original_source_required')
        if source_kind=='public-page':source_url(capture['url'])
        elif source_kind!='local-file' or contract['kind']!='local_check':raise ValueError('invalid_capture_kind')
        checked_time(capture['checked_at'])
        if not SHA.fullmatch(str(capture.get('sha256',''))):raise ValueError('invalid_capture_hash')
        raw=read_owned(capture_root,capture['path'])
        if hashlib.sha256(raw).hexdigest()!=capture['sha256']:raise ValueError('original_capture_changed')
        sources[identity]=raw.decode('utf-8')
        source_records.append({'source_id':identity,'source_kind':source_kind,'path':capture['path'],'sha256':capture['sha256'],'checked_at':checked_time(capture['checked_at']).isoformat(),**({'url':capture['url']} if source_kind=='public-page' else {})})
    if not isinstance(claims,list) or not claims or len(claims)>30:raise ValueError('claim_reviews_required')
    identities=set();facts=[]
    for claim in claims:
        identity=task_id(claim['id'])
        if identity in identities:raise ValueError('duplicate_claim')
        identities.add(identity)
        if claim.get('decision')!='supports' or claim.get('reviewer_kind')!='synthetic_fixture':raise ValueError('explicit_claim_support_review_required')
        text=claim.get('text');evidence=claim.get('evidence')
        if not isinstance(text,str) or not text.strip() or len(text)>2000 or not isinstance(evidence,list) or not evidence:raise ValueError('claim_evidence_required')
        refs=[]
        for reference in evidence:
            source=reference.get('source_id');quote=reference.get('excerpt')
            if source not in sources or not isinstance(quote,str) or not quote.strip() or len(quote)>2000 or quote not in sources[source]:raise ValueError('claim_excerpt_not_in_original')
            digest=hashlib.sha256(quote.encode()).hexdigest()
            if reference.get('excerpt_sha256')!=digest:raise ValueError('claim_excerpt_hash_mismatch')
            refs.append({'source_id':source,'excerpt_sha256':digest})
        facts.append({'claim_id':identity,'claim_sha256':hashlib.sha256(text.encode()).hexdigest(),'evidence':refs})
    revision=hashlib.sha256(canonical({'captures':captures,'claims':claims}).encode()).hexdigest()
    # The saved fact has no original text, tokens, credentials, or raw model output.
    result={'revision':revision,'decision':'synthetic_pass','synthetic':True,'verification':'unverified','claim_count':len(facts),
            'reviewer_kind':'synthetic_fixture','reviewed_at':datetime.now(timezone.utc).isoformat(),'claims':facts,'sources':source_records}
    ledger.fact(task,'review',revision,result)
    return result

def require_live_publication_review(*_args,**_kwargs):
    # Candidate mode cannot accept a caller's JSON "verified" claim as operator authority.
    raise PermissionError('verified_publication_requires_separate_operator_review')
