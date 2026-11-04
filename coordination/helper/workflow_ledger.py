"""Additive task facts beside the compatible v1 attempts table. No live transport."""
from __future__ import annotations
import hashlib,json,re,sqlite3,time
from pathlib import Path
from task_report import task_id, PROFILES, SHA
from workflow_routes import Scope

KINDS={'coordinator','specialist','worker','aside','native_result'}

def canonical(data):return json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def initialize(path: Path):
    path=Path(path)
    if path.is_symlink():raise ValueError('unsafe_database')
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path,timeout=5)
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS attempts(task TEXT,phase TEXT,input_hash TEXT,state TEXT,result TEXT,updated REAL,PRIMARY KEY(task,phase));
      CREATE TABLE IF NOT EXISTS workflow_tasks(task TEXT PRIMARY KEY,kind TEXT NOT NULL,synthetic INTEGER NOT NULL,required_phases TEXT NOT NULL,created REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_facts(sequence INTEGER PRIMARY KEY,task TEXT NOT NULL REFERENCES workflow_tasks(task),kind TEXT NOT NULL,identity TEXT NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,created REAL NOT NULL,UNIQUE(task,kind,identity));
      CREATE TRIGGER IF NOT EXISTS workflow_facts_no_update BEFORE UPDATE ON workflow_facts BEGIN SELECT RAISE(ABORT,'immutable workflow fact'); END;
      CREATE TRIGGER IF NOT EXISTS workflow_facts_no_delete BEFORE DELETE ON workflow_facts BEGIN SELECT RAISE(ABORT,'immutable workflow fact'); END;
    ''')
    return db

class WorkflowLedger:
    def __init__(self,path: Path):self.db=initialize(path)
    def close(self):self.db.close()
    def register(self,task,kind,required_phases,*,synthetic):
        task_id(task)
        if kind not in ('local_check','public_research') or type(synthetic) is not bool:raise ValueError('invalid_task_contract')
        if not isinstance(required_phases,list) or not required_phases or len(set(required_phases))!=len(required_phases) or len(required_phases)>20:raise ValueError('required_phases_needed')
        for phase in required_phases:task_id(phase)
        values=(kind,int(synthetic),canonical(required_phases))
        with self.db:
            prior=self.db.execute('SELECT kind,synthetic,required_phases FROM workflow_tasks WHERE task=?',(task,)).fetchone()
            if prior:
                if prior!=values:raise ValueError('immutable_task_contract_conflict')
                return False
            if self.db.execute('SELECT 1 FROM attempts WHERE task=? LIMIT 1',(task,)).fetchone():raise ValueError('legacy_task_must_not_be_reclassified')
            self.db.execute('INSERT INTO workflow_tasks VALUES(?,?,?,?,?)',(task,*values,time.time()))
        return True
    def contract(self,task):
        task_id(task);row=self.db.execute('SELECT kind,synthetic,required_phases FROM workflow_tasks WHERE task=?',(task,)).fetchone()
        if not row:raise ValueError('task_not_registered')
        return {'kind':row[0],'synthetic':bool(row[1]),'required_phases':json.loads(row[2])}
    def fact(self,task,kind,identity,payload):
        self.contract(task);task_id(identity)
        if kind not in ('link','transport','review','completion'):raise ValueError('invalid_fact_kind')
        raw=canonical(payload)
        if len(raw.encode())>32768:raise ValueError('fact_limit')
        digest=hashlib.sha256(raw.encode()).hexdigest()
        with self.db:
            old=self.db.execute('SELECT sha256 FROM workflow_facts WHERE task=? AND kind=? AND identity=?',(task,kind,identity)).fetchone()
            if old:
                if old[0]!=digest:raise ValueError('immutable_fact_conflict')
                return False
            self.db.execute('INSERT INTO workflow_facts(task,kind,identity,payload,sha256,created) VALUES(?,?,?,?,?,?)',(task,kind,identity,raw,digest,time.time()))
        return True
    def link(self,task,identity,*,role,phase,profile=None,workspace=None,pane=None,session=None,native_user_id=None,native_final_id=None,aside_session_id=None,sha256=None,source_kind=None):
        if role not in KINDS or (profile is not None and profile not in PROFILES):raise ValueError('invalid_link_role')
        task_id(phase)
        if phase not in self.contract(task)['required_phases']:raise ValueError('unplanned_phase')
        for value in (session,native_user_id,native_final_id,aside_session_id):
            if value is not None and not (type(value) is int and value>0) and not (isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_:.-]{1,110}',value)):raise ValueError('invalid_native_identity')
        if sha256 is not None and not SHA.fullmatch(str(sha256)):raise ValueError('invalid_result_hash')
        if role=='native_result' and (native_final_id is None or sha256 is None):raise ValueError('native_final_and_hash_required')
        if role=='worker':
            from workflow_routes import TEAMS
            if profile not in TEAMS or workspace!=TEAMS[profile][0] or not re.fullmatch(re.escape(workspace)+r':p[A-Za-z0-9]+',pane or ''):raise ValueError('worker_profile_binding_mismatch')
        if role in ('specialist','worker') and (profile is None or not session):raise ValueError('existing_identity_required')
        if role=='worker' and (not workspace or not pane or source_kind!='existing_herdr_worker'):raise ValueError('worker_binding_required')
        if role=='specialist' and source_kind!='existing_hermes_bot_chat':raise ValueError('general_subagent_is_not_existing_specialist')
        if role=='aside' and not aside_session_id:raise ValueError('aside_execution_id_required')
        data={k:v for k,v in {'role':role,'phase':phase,'profile':profile,'workspace':workspace,'pane':pane,'session':session,'native_user_id':native_user_id,'native_final_id':native_final_id,'aside_session_id':aside_session_id,'sha256':sha256,'source_kind':source_kind}.items() if v is not None}
        return self.fact(task,'link',identity,data)
    def synthetic_run(self,task,phase,profile,scope:Scope,request,transport):
        contract=self.contract(task)
        scope.require(task,profile,'synthetic-dispatch',synthetic=contract['synthetic'])
        if not contract['synthetic']:raise PermissionError('synthetic_adapter_cannot_send_real_work')
        if phase not in contract['required_phases']:raise ValueError('unplanned_phase')
        digest=hashlib.sha256(canonical(request).encode()).hexdigest()
        try:
            with self.db:self.db.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?)',(task,phase,digest,'reserved',None,time.time()))
        except sqlite3.IntegrityError:raise ValueError('already_reserved_never_resend') from None
        # Reservation is committed before a callback can have any effect.
        try:
            receipt=transport(request)
            if not isinstance(receipt,dict):raise ValueError('invalid_transport_receipt')
            raw=canonical({'synthetic':True,'receipt':receipt})
            if len(raw.encode())>32768:raise ValueError('transport_receipt_limit')
        except Exception:
            with self.db:self.db.execute('UPDATE attempts SET state=?,updated=? WHERE task=? AND phase=?',('uncertain',time.time(),task,phase))
            self.fact(task,'transport',phase,{'state':'uncertain','synthetic':True})
            raise
        # Any persistence failure retains the committed reservation; retry never resends.
        with self.db:self.db.execute('UPDATE attempts SET state=?,result=?,updated=? WHERE task=? AND phase=?',('returned_unverified',raw,time.time(),task,phase))
        self.fact(task,'transport',phase,{'state':'returned_unverified','synthetic':True,'receipt_sha256':hashlib.sha256(canonical(receipt).encode()).hexdigest()})
        return receipt
    def phase_states(self,task):
        return dict(self.db.execute('SELECT phase,state FROM attempts WHERE task=?',(task,)))
    def complete_synthetic(self,task,revision):
        contract=self.contract(task)
        if not contract['synthetic']:raise PermissionError('live_completion_requires_separate_review_authority')
        states=self.phase_states(task)
        if any(states.get(p) not in ('returned_unverified','native_reply_collected') for p in contract['required_phases']):raise ValueError('required_phase_unresolved')
        receipts={identity:json.loads(payload) for identity,payload in self.db.execute("SELECT identity,payload FROM workflow_facts WHERE task=? AND kind='transport'",(task,))}
        selected=[receipts.get(p) or receipts.get(p+'-native_reply_collected',{}) for p in contract['required_phases']]
        if any(v.get('state') not in ('returned_unverified','native_reply_collected') or v.get('synthetic') is not True or not SHA.fullmatch(str(v.get('receipt_sha256',''))) for v in selected):raise ValueError('required_transport_receipt_missing')
        links=[json.loads(r[0]) for r in self.db.execute("SELECT payload FROM workflow_facts WHERE task=? AND kind='link'",(task,))]
        roles={v.get('role') for v in links}
        required={'coordinator','specialist','worker','native_result'}
        if contract['kind']=='public_research':required.add('aside')
        if not required.issubset(roles) or any(not any(v.get('phase')==p for v in links) for p in contract['required_phases']):raise ValueError('required_trace_links_missing')
        reviews=self.db.execute("SELECT payload FROM workflow_facts WHERE task=? AND kind='review'",(task,)).fetchall()
        if not any((v:=json.loads(r[0])).get('revision')==revision and v.get('decision')=='synthetic_pass' and v.get('synthetic') is True for r in reviews):raise ValueError('matching_claim_review_required')
        result={'revision':revision,'synthetic':True,'verification':'unverified','decision':'synthetic_complete_only'}
        self.fact(task,'completion',revision,result)
        return result
