"""No real dispatch, models, Herdr discovery or operating-directory writes."""
import hashlib
import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'helper'))
from operator_approval import ApprovalIssuer
from registered_cli import ReviewedApprovalStore, dispatch_request, load_bindings, main, preview, read_request, terminal_reviewer
from workflow_ledger import canonical

spec = importlib.util.spec_from_file_location('coordination_install', SOURCE / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class RegisteredEntryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        self.roots = {}
        self.seats = {'seats': []}
        for profile, workspace in installer.WORKSPACES.items():
            root = self.home / 'owner-projects' / profile
            root.mkdir(parents=True)
            self.roots[profile] = str(root)
            self.seats['seats'].append({'kind': 'hermes', 'name': profile + '_controller', 'workspace_id': workspace, 'cwd': str(root)})
        (self.home / '.hermes/profiles/giselle/skills').mkdir(parents=True)
        self.state = self.home / '.hermes/profiles/giselle/runtime/ohha-control'
        self.state.mkdir(parents=True)
        self.request = {'task': 'fixture_registered', 'profile': 'paul', 'route': 'specialist', 'prompt': 'Synthetic bounded input only', 'kind': 'local_check', 'required_phases': ['specialist-paul']}
        self.scope = {'task': 'fixture_registered', 'phase': 'specialist-paul', 'route': 'specialist-resume', 'profile': 'paul', 'session': 'fixture_native', 'cwd': self.roots['paul'], 'prompt_sha256': 'a' * 64}

    def install(self):
        return installer.install(self.home, SOURCE, self.roots, self.seats)

    def grant(self):
        root = self.home / '.hermes/ohha-coordination/approvals'
        reviewer = lambda proposal: {'decision': 'approved', 'proposal_sha256': hashlib.sha256(canonical(proposal).encode()).hexdigest()}
        result = ApprovalIssuer(root, reviewer).issue(self.scope, synthetic=False)
        return root, result

    def test_registration_is_separate_idempotent_and_has_no_grants_or_ledger(self):
        legacy = self.home / '.hermes/ohha-control/current'
        legacy.mkdir(parents=True)
        (legacy / 'preserved').write_text('old helper')
        first = self.install()
        second = self.install()
        self.assertEqual(first['version'], second['version'])
        self.assertEqual((legacy / 'preserved').read_text(), 'old helper')
        self.assertFalse((self.state / 'ledger.sqlite3').exists())
        self.assertEqual(list((self.home / '.hermes/ohha-coordination/approvals').iterdir()), [])
        self.assertEqual(load_bindings(self.home)['paul'][1], 'owner-projects/paul')
        self.assertEqual((self.home / '.hermes/profiles/giselle/skills/ohha-coordination').resolve(), Path(first['release']))

    def test_inventory_mismatch_is_refused_before_registration(self):
        self.seats['seats'][0]['workspace_id'] = 'w99'
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse((self.home / '.hermes/ohha-coordination').exists())

    def test_existing_skill_and_modified_release_are_preserved(self):
        skill = self.home / '.hermes/profiles/giselle/skills/ohha-coordination'
        skill.mkdir()
        with self.assertRaises(ValueError):
            self.install()
        skill.rmdir()
        result = self.install()
        entry = Path(result['release']) / 'registered_cli.py'
        entry.write_text('changed fixture')
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual(entry.read_text(), 'changed fixture')

    def test_default_dispatch_denies_before_preview_and_ledger(self):
        with patch('registered_cli.preview', side_effect=AssertionError('must not discover')):
            with self.assertRaises(PermissionError):
                dispatch_request(self.request, None, self.home, self.state, {})
        self.assertFalse((self.state / 'ledger.sqlite3').exists())

    def test_cli_missing_grant_denies_before_integrity_or_configuration(self):
        with patch('registered_cli.self_integrity', side_effect=AssertionError('must not read configuration')):
            with self.assertRaises(PermissionError):
                main(['dispatch', '--request', 'unused'])

    def test_private_input_rejects_extra_fields_world_readability_and_symlinks(self):
        request = self.home / 'request.json'
        request.write_text(json.dumps(self.request)); request.chmod(0o600)
        self.assertEqual(read_request(request), self.request)
        request.write_text(json.dumps({**self.request, 'execute': True}))
        with self.assertRaises(ValueError):
            read_request(request)
        request.write_text(json.dumps(self.request)); request.chmod(0o644)
        with self.assertRaises(PermissionError):
            read_request(request)
        link = self.home / 'request-link'; link.symlink_to(request)
        with self.assertRaises(OSError):
            read_request(link)

    def test_approval_is_exact_hash_bound_and_cannot_be_broadened(self):
        self.install(); root, result = self.grant()
        store = ReviewedApprovalStore(root)
        store.authorize(result['approval_id'], self.scope, synthetic=False)
        record = root / (result['approval_id'] + '.json')
        value = json.loads(record.read_text()); value['max_turns'] = 4
        record.write_text(json.dumps(value))
        with self.assertRaisesRegex(PermissionError, 'proposal_hash'):
            store.authorize(result['approval_id'], self.scope, synthetic=False)

    def test_expired_or_other_target_grant_never_reaches_operating_ledger(self):
        self.install(); root, result = self.grant()
        for scope in [{**self.scope, 'session': 'different'}, self.scope]:
            if scope == self.scope:
                path = root / (result['approval_id'] + '.json')
                value = json.loads(path.read_text()); value['expires_at'] = 0
                path.write_text(json.dumps(value))
            with patch('registered_cli.preview', return_value=scope), patch('registered_cli.WorkflowLedger', side_effect=AssertionError('must not mutate ledger')):
                with self.assertRaises(PermissionError):
                    dispatch_request(self.request, result['approval_id'], self.home, self.state, {})

    def test_owner_review_cannot_be_used_through_noninteractive_input(self):
        with patch('registered_cli.os.isatty', return_value=False):
            with self.assertRaises(PermissionError):
                terminal_reviewer('fixture')

    def test_preview_uses_owner_binding_without_operating_ledger_writes(self):
        self.install(); teams = load_bindings(self.home)
        with patch('delivery_adapter.canonical_profile', return_value={'session': 'fixture_native'}):
            scope = preview(self.request, self.home, self.state, teams, source_check=lambda: None)
        self.assertEqual(scope['cwd'], self.roots['paul'])
        self.assertFalse((self.state / 'ledger.sqlite3').exists())
        self.assertEqual(list((self.home / '.hermes/ohha-coordination/approvals').iterdir()), [])

    def test_exact_approved_entry_uses_fake_transport_once_and_preserves_duplicate_guard(self):
        self.install(); teams = load_bindings(self.home)
        profile = self.home / '.hermes/profiles/paul'
        (profile / 'runtime').mkdir(parents=True)
        (profile / 'runtime/active_sessions.json').write_text('{"entries":[]}')
        with closing(sqlite3.connect(profile / 'state.db')) as db, db:
            db.executescript("CREATE TABLE sessions(id TEXT,title TEXT,profile_name TEXT); CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,tool_calls TEXT); INSERT INTO sessions VALUES('fixture_native','Bot Chat','paul');")
        scope = preview(self.request, self.home, self.state, teams, source_check=lambda: None)
        reviewer = lambda p: {'decision': 'approved', 'proposal_sha256': hashlib.sha256(canonical(p).encode()).hexdigest()}
        grant = ApprovalIssuer(self.home / '.hermes/ohha-coordination/approvals', reviewer).issue(scope, synthetic=False)
        calls = []

        class FakeTransport:
            synthetic = False

            def execute(inner, command, started=None):
                calls.append(command)
                if started:
                    started({'pid': 900001})
                wire = Path(command.argv[command.argv.index('--query-file') + 1]).read_text()
                with closing(sqlite3.connect(profile / 'state.db')) as db, db:
                    db.execute("INSERT INTO messages(session_id,role,content) VALUES('fixture_native','user',?)", (wire,))
                    db.execute("INSERT INTO messages(session_id,role,content) VALUES('fixture_native','assistant','fixture reply')")
                return {'pid': 900001, 'exit_code': 0, 'timed_out': False}

        with patch('delivery_adapter.subprocess.Popen', side_effect=AssertionError('no native process')):
            result = dispatch_request(self.request, grant['approval_id'], self.home, self.state, teams, source_check=lambda: None, port=FakeTransport())
            self.assertEqual(result['state'], 'native_reply_collected')
            self.assertEqual(result['verification'], 'unverified')
            with self.assertRaises(ValueError):
                dispatch_request(self.request, grant['approval_id'], self.home, self.state, teams, source_check=lambda: None, port=FakeTransport())
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].cwd, Path(self.roots['paul']))


if __name__ == '__main__':
    unittest.main()
