"""Versioned owner-gated entry point; no daemon, credentials or automatic dispatch."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import time

from delivery_adapter import DeliveryService
from delivery_approval import ApprovalStore
from operator_approval import ApprovalIssuer
from task_report import inspect_task, task_id
from workflow_ledger import WorkflowLedger, canonical
from workflow_routes import TEAMS


def private_json(path, maximum=16384):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > maximum:
            raise PermissionError('owner_private_file_required')
        raw = os.read(fd, maximum + 1)
        if len(raw) > maximum:
            raise ValueError('input_limit')
        return json.loads(raw)
    finally:
        os.close(fd)


def load_bindings(home):
    config = private_json(home / '.hermes/ohha-coordination/bindings.json')
    if not isinstance(config, dict) or set(config) != {'schema', 'origin', 'teams'} or config['schema'] != 1 or config['origin'] != 'existing_owner_approved_startup_inventory':
        raise ValueError('reviewed_existing_bindings_required')
    if not isinstance(config['teams'], dict) or set(config['teams']) != set(TEAMS):
        raise ValueError('exact_existing_profiles_required')
    teams = {}
    for profile, row in config['teams'].items():
        if not isinstance(row, dict) or set(row) != {'workspace', 'relative_root'} or row['workspace'] != TEAMS[profile][0] or not isinstance(row['relative_root'], str):
            raise ValueError('existing_workspace_binding_mismatch')
        relative = Path(row['relative_root'])
        root = home / relative
        if relative.is_absolute() or not relative.parts or any(p in ('.', '..') for p in relative.parts) or root.resolve() != root or not root.is_dir():
            raise ValueError('existing_owner_project_root_required')
        teams[profile] = (row['workspace'], str(relative))
    return teams


def read_request(path):
    request = private_json(path)
    required = {'task', 'profile', 'route', 'prompt', 'kind', 'required_phases'}
    if not isinstance(request, dict) or set(request) != required:
        raise ValueError('exact_request_schema_required')
    task_id(request['task'])
    if not isinstance(request['profile'], str) or request['profile'] not in TEAMS or request['route'] not in ('specialist', 'worker'):
        raise ValueError('existing_target_required')
    if request['kind'] not in ('local_check', 'public_research'):
        raise ValueError('invalid_task_kind')
    phases = request['required_phases']
    if not isinstance(phases, list) or not 1 <= len(phases) <= 20:
        raise ValueError('exact_required_phases_needed')
    for phase in phases:
        task_id(phase)
    if len(set(phases)) != len(phases):
        raise ValueError('exact_required_phases_needed')
    phase = request['route'] + '-' + request['profile']
    if phase not in phases:
        raise ValueError('unplanned_phase')
    # Reuse the actual transport's input admission and wire format.
    DeliveryService._wire(None, request['task'], phase, request['prompt'])
    return request


class PreviewLedger:
    """Resolve a proposal without creating or migrating the operating ledger."""
    def __init__(self, request):
        self.request = request
        self.db = sqlite3.connect(':memory:')

    def contract(self, task):
        if task != self.request['task']:
            raise ValueError('proposal_task_mismatch')
        return {'synthetic': False, 'kind': self.request['kind'], 'required_phases': self.request['required_phases']}


def preview(request, home, state, teams, *, snapshot=None, source_check=None):
    ledger = PreviewLedger(request)
    try:
        service = DeliveryService(ledger, home, state, teams=teams, snapshot=snapshot, source_check=source_check)
        service.source_check()
        target = service._target(request['task'], request['profile'], request['route'])
        phase = request['route'] + '-' + request['profile']
        wire = service._wire(request['task'], phase, request['prompt'])
        return {'task': request['task'], 'phase': phase, **target, 'prompt_sha256': hashlib.sha256(wire.encode()).hexdigest()}
    finally:
        ledger.db.close()


class ReviewedApprovalStore(ApprovalStore):
    """The registered entry accepts only bounded, hash-bound issuer receipts."""
    def authorize(self, approval_id, expected, *, synthetic):
        result = super().authorize(approval_id, expected, synthetic=synthetic)
        value = private_json(self.root / (approval_id + '.json'))
        issued = value.get('issued_at')
        lifetime = value.get('lifetime')
        if type(issued) not in (int, float) or not math.isfinite(issued) or issued > time.time() or type(lifetime) not in (int, float) or not math.isfinite(lifetime) or not 1 <= lifetime <= 300 or value['expires_at'] != issued + lifetime:
            raise PermissionError('bounded_review_lifetime_required')
        proposal = {'scope': expected, 'synthetic': synthetic, 'wait_seconds': result['wait_seconds'], 'max_turns': result['max_turns'], 'run_budget': result['run_budget'], 'lifetime': lifetime}
        if value.get('reviewed_proposal_sha256') != hashlib.sha256(canonical(proposal).encode()).hexdigest():
            raise PermissionError('reviewed_proposal_hash_required')
        return result


def require_owner_terminal():
    if not os.isatty(0) or os.tcgetpgrp(0) != os.getpgrp():
        raise PermissionError('owner_foreground_terminal_required')
    parent = subprocess.check_output(['/bin/ps', '-p', str(os.getppid()), '-o', 'comm='], text=True).strip()
    if Path(parent).name.lstrip('-') not in ('zsh', 'bash', 'sh', 'fish'):
        raise PermissionError('direct_owner_shell_required')


def terminal_reviewer(prompt):
    require_owner_terminal()

    def review(proposal):
        digest = hashlib.sha256(canonical(proposal).encode()).hexdigest()
        # JSON escaping keeps terminal-control characters in prompts inert.
        with open('/dev/tty', 'r+', encoding='utf-8') as tty:
            tty.write('Review one existing-session request. No retry or new session is authorized.\n')
            tty.write(json.dumps({'proposal': proposal, 'prompt': prompt}, ensure_ascii=False, indent=2) + '\n')
            tty.write('To authorize, type approve followed by this exact hash:\n' + digest + '\n> ')
            tty.flush()
            answer = tty.readline(160).strip()
        if answer != 'approve ' + digest:
            raise PermissionError('explicit_owner_review_required')
        return {'decision': 'approved', 'proposal_sha256': digest}

    return review


def dispatch_request(request, approval_id, home, state, teams, *, snapshot=None, source_check=None, port=None):
    # Fail closed before native discovery, ledger writes or process construction.
    if not approval_id or not re.fullmatch(r'[a-f0-9]{32}', approval_id):
        raise PermissionError('per_request_owner_approval_required')
    store = ReviewedApprovalStore(home / '.hermes/ohha-coordination/approvals')
    # Missing/unsafe grants are rejected before any target discovery.
    private_json(store.root / (approval_id + '.json'))
    scope = preview(request, home, state, teams, snapshot=snapshot, source_check=source_check)
    store.authorize(approval_id, scope, synthetic=False)
    ledger = WorkflowLedger(state / 'ledger.sqlite3')
    try:
        ledger.register(request['task'], request['kind'], request['required_phases'], synthetic=False)
        service = DeliveryService(ledger, home, state, teams=teams, approvals=store, snapshot=snapshot, source_check=source_check, port=port)
        return service.dispatch(request['task'], request['profile'], request['route'], request['prompt'], approval_id)
    finally:
        ledger.close()


def self_integrity():
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / 'manifest.json').read_text())
    for name, expected in manifest['files'].items():
        path = root / name
        if Path(name).name != name or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise PermissionError('registered_source_changed_reinstall_reviewed_version')
    return manifest['version']


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('status')
    report = sub.add_parser('task-report'); report.add_argument('--task', required=True)
    for action in ('prepare', 'approve', 'dispatch'):
        command = sub.add_parser(action); command.add_argument('--request', required=True, type=Path)
        if action == 'dispatch':
            command.add_argument('--approval')
        if action == 'approve':
            command.add_argument('--wait-seconds', type=int, default=45)
            command.add_argument('--max-turns', type=int, default=3)
            command.add_argument('--run-budget', type=int, default=30)
            command.add_argument('--lifetime', type=int, default=120)
    args = parser.parse_args(argv)
    if args.action == 'dispatch' and not args.approval:
        raise PermissionError('per_request_owner_approval_required')
    home = Path.home()
    state = home / '.hermes/profiles/giselle/runtime/ohha-control'
    version = self_integrity()
    teams = load_bindings(home)
    if args.action == 'status':
        value = {'version': version, 'registered': True, 'default_dispatch': 'deny', 'approval_required': 'exact_target_input_hash_and_expiry', 'bound_profiles': sorted(teams), 'legacy_helper_replaced': False, 'live_collaboration': 'unverified', 'model_call_performed': False}
    elif args.action == 'task-report':
        value = inspect_task(args.task, state, home / 'Desktop/Obsidian-Syncthing/MyObsidianVault')
    else:
        request = read_request(args.request)
        if args.action == 'dispatch':
            value = dispatch_request(request, args.approval, home, state, teams)
        else:
            if args.action == 'approve':
                require_owner_terminal()
            scope = preview(request, home, state, teams)
            if args.action == 'prepare':
                value = {'scope': scope, 'execution': 'proposal_only', 'approval_issued': False}
            else:
                value = ApprovalIssuer(home / '.hermes/ohha-coordination/approvals', terminal_reviewer(request['prompt'])).issue(scope, synthetic=False, wait_seconds=args.wait_seconds, max_turns=args.max_turns, run_budget=args.run_budget, lifetime=args.lifetime)
    print(json.dumps(value, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, PermissionError, OSError, sqlite3.Error) as error:
        # Do not echo prompt data, paths, transcripts or provider errors.
        code = str(error) if isinstance(error, (ValueError, PermissionError)) and re.fullmatch(r'[a-z_]+', str(error)) else 'local_gate_unavailable'
        print(json.dumps({'state': 'blocked_or_uncertain', 'code': code, 'instruction': 'inspect_existing_task_before_any_retry'}))
        raise SystemExit(2)
