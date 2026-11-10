import { expect, test } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const python = join(homedir(), '.hermes/hermes-agent/venv/bin/python')
// Optional local compatibility test. Creates only a fake DB under a temporary HERMES_HOME.
test.skipIf(!existsSync(python))(
  'installed official SessionDB interface reads only the selected fake conversation without writes',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-session-interface-'))
    try {
      const result = execFileSync(
        python,
        [
          '-I',
          '-B',
          '-c',
          `import sys,os,importlib.util,hashlib,json,logging
from pathlib import Path
logging.disable(logging.CRITICAL)
root=Path(sys.argv[1]);os.environ['HERMES_HOME']=str(root);os.environ['HERMES_DISABLE_LAZY_INSTALLS']='1'
sys.path.insert(0,str(Path.home()/'.hermes/hermes-agent'))
from hermes_state import SessionDB
from agent.redact import redact_sensitive_text
p=root/'state.db'
with SessionDB(db_path=p) as db:
 db.create_session('chosen_fixture',source='oneshot',model_config={'provider':'openai-codex'},system_prompt='fixture memory must not be read')
 db.append_message('chosen_fixture','user','local fixture input')
 db.append_message('chosen_fixture','assistant','local fixture answer')
 db.create_session('unrelated_fixture',source='cron')
 db.append_message('unrelated_fixture','user','unrelated fixture must not be read')
s=importlib.util.spec_from_file_location('reader',sys.argv[2]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
before=hashlib.sha256(p.read_bytes()).hexdigest()
m.restrict_process()
with m.metadata_only_db(SessionDB)(db_path=p,read_only=True) as db:
 metadata=db.get_session('chosen_fixture');assert 'system_prompt' not in metadata
 result=m.read_selected(db,'chosen_fixture',redact_sensitive_text)
 assert len(result['messages'])==2 and result['sessionId']=='chosen_fixture'
 summary=m.read_summary(db,'chosen_fixture',redact_sensitive_text)
 assert summary['title']=='local fixture input' and isinstance(summary['startedAt'],(float,int))
 assert 'unrelated' not in json.dumps(result) and 'fixture memory' not in json.dumps(result)
 try:m.read_selected(db,'unrelated_fixture',redact_sensitive_text)
 except ValueError:pass
 else:raise AssertionError('automation source accepted')
 assert hashlib.sha256(p.read_bytes()).hexdigest()==before
print('official interface / selected only / unchanged')`,
          root,
          join(process.cwd(), 'protected/sessions.py')
        ],
        { encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } }
      )
      expect(result.trim()).toBe('official interface / selected only / unchanged')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)
