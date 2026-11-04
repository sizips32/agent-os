"""Exact existing-session readers. No model calls, glob fallback, or semantic verdict."""
from __future__ import annotations
import hashlib,json,os,re,stat
from pathlib import Path
from task_report import readonly_connection,task_id
from workflow_routes import canonical_profile,TEAMS

def specialist_request_exists(home,profile,session,wire):
    db=readonly_connection(home/'.hermes/profiles'/profile/'state.db')
    try:return db.execute("SELECT 1 FROM messages WHERE session_id=? AND role='user' AND content=? LIMIT 1",(session,wire)).fetchone() is not None
    finally:db.close()

def specialist_final(home,profile,session,wire_hash):
    if canonical_profile(home,profile)['session']!=session:raise ValueError('specialist_identity_changed')
    db=readonly_connection(home/'.hermes/profiles'/profile/'state.db')
    try:
        users=db.execute("SELECT id,content FROM messages WHERE session_id=? AND role='user' ORDER BY id DESC LIMIT 100",(session,)).fetchall()
        users=[(i,text) for i,text in users if isinstance(text,str) and hashlib.sha256(text.encode()).hexdigest()==wire_hash]
        if len(users)!=1:raise ValueError('matching_native_user_not_unique')
        user=users[0][0]
        next_user=db.execute("SELECT MIN(id) FROM messages WHERE session_id=? AND role='user' AND id>?",(session,user)).fetchone()[0] or 2**62
        final=db.execute("SELECT id,content FROM messages WHERE session_id=? AND role='assistant' AND id>? AND id<? AND tool_calls IS NULL AND content IS NOT NULL AND content<>'' ORDER BY id DESC LIMIT 1",(session,user,next_user)).fetchone()
        if final is None or len(final[1])>16000:raise ValueError('bounded_native_final_unavailable')
        return {'session':session,'native_user_id':user,'native_final_id':final[0],'sha256':hashlib.sha256(final[1].encode()).hexdigest(),'text':final[1],'source_kind':'existing_hermes_bot_chat'}
    finally:db.close()

def claude_transcript(home,profile,session,*,teams=None):
    task_id(session)
    cwd=home/(TEAMS if teams is None else teams)[profile][1]
    base=home/'.claude/projects';name=re.sub(r'[^A-Za-z0-9]','-',str(cwd))
    if base.is_symlink():raise ValueError('unsafe_transcript_root')
    root=os.open(base,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        project=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=root)
        try:
            fd=os.open(session+'.jsonl',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=project)
            try:
                info=os.fstat(fd)
                if not stat.S_ISREG(info.st_mode):raise ValueError('unsafe_transcript')
                start=max(0,info.st_size-8*1024*1024);os.lseek(fd,start,0);raw=os.read(fd,8*1024*1024)
            finally:os.close(fd)
        finally:os.close(project)
    finally:os.close(root)
    if start:raw=raw.partition(b'\n')[2]
    records=[]
    for line in raw.decode('utf-8',errors='strict').splitlines():
        try:r=json.loads(line)
        except ValueError:continue
        if isinstance(r,dict):records.append(r)
    return records

def content(record):
    value=record.get('message',{}).get('content','')
    return ''.join(v.get('text','') for v in value if isinstance(v,dict) and v.get('type')=='text') if isinstance(value,list) else value

def worker_final(home,profile,session,wire_hash,*,teams=None):
    records=claude_transcript(home,profile,session,teams=teams);users=[];active=None;final=None;cwd=home/(TEAMS if teams is None else teams)[profile][1]
    for row in records:
        text=content(row)
        if row.get('type')=='user':
            active=None
            if isinstance(text,str) and hashlib.sha256(text.encode()).hexdigest()==wire_hash and Path(row.get('cwd',''))==cwd:
                users.append(row.get('uuid'));active=row.get('uuid');final=None
        elif active and row.get('type')=='assistant' and row.get('message',{}).get('stop_reason')=='end_turn' and row.get('isApiErrorMessage') is not True and isinstance(text,str) and text.strip() and len(text)<=16000:
            final={'session':session,'native_user_id':active,'native_final_id':row.get('uuid'),'sha256':hashlib.sha256(text.encode()).hexdigest(),'text':text,'source_kind':'existing_herdr_worker'}
    if len(users)!=1 or final is None or not final['native_final_id']:raise ValueError('matching_worker_final_unavailable')
    return final
