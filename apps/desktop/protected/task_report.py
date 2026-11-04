"""Read-only OH-HA task and current artifact projection. No imports of agents/tools."""
from __future__ import annotations
import hashlib, json, os, re, sqlite3, stat, uuid
from pathlib import Path

ID = re.compile(r'[A-Za-z0-9_-]{1,90}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')
DESTINATIONS = ('0_INBOX', '_giselle/OH-HA_Agent_OS/Records')
PROFILES = ('paul', 'james', 'jarvis', 'atelier')
STATES = {'reserved','uncertain','returned_unverified','native_reply_collected','native_reply_format_mismatch','blocked','child_started','running','completed','failed'}

def task_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value): raise ValueError('invalid_task_id')
    return value

def read_owned(root: Path, relative: str, maximum=131072) -> bytes:
    root = Path(root)
    if root.is_symlink() or not root.is_dir(): raise ValueError('unsafe_root')
    if not isinstance(relative,str) or any(p in ('','.') for p in relative.split('/')):raise ValueError('unsafe_path')
    rel = Path(relative)
    if rel.is_absolute() or not rel.parts or any(p in ('.','..') or p.startswith('.') for p in rel.parts): raise ValueError('unsafe_path')
    # openat + O_NOFOLLOW protects every directory, including a concurrent symlink swap.
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in rel.parts[:-1]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = nxt
        leaf = os.open(rel.parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            info = os.fstat(leaf)
            if not stat.S_ISREG(info.st_mode) or info.st_size > maximum: raise ValueError('file_limit')
            with os.fdopen(leaf, 'rb', closefd=False) as stream: raw = stream.read(maximum+1)
            if len(raw) > maximum: raise ValueError('file_limit')
            return raw
        finally: os.close(leaf)
    finally: os.close(fd)

def resolve_note(task, state: Path, vault: Path):
    task_id(task); state, vault = Path(state), Path(vault)
    base = {'status':'not_found', 'task_id':task, 'hash_matches':False}
    if not state.exists() and not state.is_symlink():return base
    try: record = json.loads(read_owned(state, task+'-knowledge.json'))
    except FileNotFoundError: return base
    except (ValueError, OSError, json.JSONDecodeError): return {**base, 'status':'unsafe_record'}
    name = 'AgentOS-'+str(uuid.uuid5(uuid.NAMESPACE_URL, 'ohha:'+task))+'.md'
    if not isinstance(record,dict) or record.get('task_id') != task or not SHA.fullmatch(str(record.get('sha256',''))): return {**base,'status':'invalid_record'}
    try:
        original = Path(record['path']).relative_to(vault)
        if str(original.parent) not in DESTINATIONS or original.name != name: raise ValueError()
    except (KeyError, TypeError, ValueError): return {**base,'status':'unsafe_record'}
    matches, changed = [], False
    for destination in DESTINATIONS:
        relative = destination+'/'+name
        try: raw = read_owned(vault, relative)
        except FileNotFoundError: continue
        except (ValueError, OSError): return {**base,'status':'unsafe_note'}
        if hashlib.sha256(raw).hexdigest() == record['sha256']: matches.append(relative)
        else: changed = True
    if changed: return {**base,'status':'changed'}
    if len(matches)>1: return {**base,'status':'ambiguous'}
    if not matches: return {**base,'status':'missing'}
    artifact = record.get('artifact',{})
    if not isinstance(artifact,dict):artifact={}
    verification = artifact.get('verification','unverified')
    if verification not in ('verified','partial','unverified','blocked'): verification='unverified'
    return {'task_id':task,'status':'resolved' if matches[0] == str(original) else 'moved','relative_path':matches[0],
            'sha256':record['sha256'],'hash_matches':True,'declared_verification':verification,
            'source_count':len(artifact.get('sources',[])) if isinstance(artifact.get('sources'),list) else 0}

def readonly_connection(path: Path):
    path = Path(path)
    if path.is_symlink():raise ValueError('unsafe_database')
    if not path.exists(): return None
    if path.is_symlink() or not path.is_file(): raise ValueError('unsafe_database')
    db = sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=2)
    db.execute('PRAGMA query_only=ON')
    return db

def _table(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(name,)).fetchone() is not None

def _identity(value):
    return value if isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_:.-]{1,110}',value) else None

def inspect_task(task, state: Path, vault: Path):
    task_id(task); state, vault = Path(state), Path(vault)
    result={'task_id':task,'read_only':True,'phases':[],'links':[],'reviews':[], 'note':resolve_note(task,state,vault),
            'computed_verification':'unverified','live_execution_enabled':False}
    db=readonly_connection(state/'ledger.sqlite3')
    if db is None: return result
    try:
        if _table(db,'attempts'):
            for phase,status,payload in db.execute('SELECT phase,state,result FROM attempts WHERE task=? ORDER BY phase LIMIT 100',(task,)):
                if not isinstance(phase,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',phase): continue
                try: raw=json.loads(payload or '{}')
                except (ValueError,TypeError): raw={}
                if not isinstance(raw,dict): raw={}
                entry={'phase':phase,'state':status if status in STATES else 'native_final_unverified' if str(status).startswith('native_final_received') else 'unknown'}
                profile=phase.split('-')[-1]
                if profile in PROFILES:entry['profile']=profile
                for key in ('session','session_id','pane','workspace','aside_session_id','user_id','final_id'):
                    value=raw.get(key)
                    if _identity(value) is not None:entry[key]=value
                    elif key in ('user_id','final_id') and type(value) is int and value>0:entry[key]=value
                if SHA.fullmatch(str(raw.get('sha256',''))):entry['sha256']=raw['sha256']
                result['phases'].append(entry)
        if _table(db,'workflow_tasks'):
            row=db.execute('SELECT kind,synthetic FROM workflow_tasks WHERE task=?',(task,)).fetchone()
            if row and row[0] in ('local_check','public_research'):result.update(kind=row[0],synthetic=bool(row[1]))
        if _table(db,'workflow_facts'):
            for kind,identity,payload in db.execute('SELECT kind,identity,payload FROM workflow_facts WHERE task=? ORDER BY sequence LIMIT 100',(task,)):
                try:data=json.loads(payload)
                except (ValueError,TypeError):continue
                if not isinstance(data,dict):continue
                # Only constrained metadata can leave the local ledger. No arbitrary strings.
                data={k:v for k,v in data.items() if _identity(v) is not None or type(v) is bool or (type(v) is int and 0<=v<=1000000000)}
                if kind=='link':
                    result['links'].append({k:v for k,v in data.items() if k in ('role','profile','workspace','pane','session','native_user_id','native_final_id','aside_session_id','sha256','phase','source_kind')})
                elif kind=='review':result['reviews'].append({k:v for k,v in data.items() if k in ('revision','claim_count','decision','synthetic','reviewed_at','reviewer_kind')})
                elif kind=='completion' and data.get('synthetic') is True:result['computed_verification']='synthetic_only'
        return result
    finally:db.close()
