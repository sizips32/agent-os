"""Register this reviewed version beside the existing helper; never execute it."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile

WORKSPACES = {'paul': 'w2', 'james': 'w4', 'jarvis': 'w6', 'atelier': 'w7'}
MANAGER = 'ohha-versioned-coordination-owner-approved'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def bindings_from_existing(home, roots, seats):
    if set(roots) != set(WORKSPACES):
        raise ValueError('exact_approved_profile_roots_required')
    teams = {}
    for profile, workspace in WORKSPACES.items():
        root = Path(roots[profile])
        if not root.is_absolute() or root.resolve() != root or not root.is_dir():
            raise ValueError('existing_non_symlink_project_required')
        relative = root.relative_to(home)
        controllers = [s for s in seats['seats'] if s.get('kind') == 'hermes' and s.get('name') == profile + '_controller']
        if len(controllers) != 1 or controllers[0].get('workspace_id') != workspace or controllers[0].get('cwd') != str(root):
            raise ValueError('approved_root_and_existing_controller_inventory_must_match')
        teams[profile] = {'workspace': workspace, 'relative_root': str(relative)}
    return {'schema': 1, 'origin': 'existing_owner_approved_startup_inventory', 'teams': teams}


def existing_private_directory(path):
    if path.is_symlink() or not path.is_dir():
        raise ValueError('private_directory_required')
    info = path.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('private_directory_required')


def install(home, source, roots, seats):
    home, source = Path(home), Path(source)
    binding = bindings_from_existing(home, roots, seats)
    files = {p.name: p.read_bytes() for p in sorted((source / 'helper').iterdir()) if p.is_file() and (p.suffix == '.py' or p.name == 'delivery-interfaces.json')}
    files['SKILL.md'] = (source / 'SKILL.md').read_bytes()
    hashes = {name: digest(raw) for name, raw in files.items()}
    version = digest(json.dumps(hashes, sort_keys=True).encode())[:16]
    root = home / '.hermes/ohha-coordination'
    skill = home / '.hermes/profiles/giselle/skills/ohha-coordination'
    prior = root.exists() or root.is_symlink()
    if prior:
        existing_private_directory(root)
        if json.loads((root / 'managed.json').read_text()).get('manager') != MANAGER:
            raise ValueError('unmanaged_registration_preserved')
    if skill.exists() or skill.is_symlink():
        if not skill.is_symlink() or os.readlink(skill) != str(root / 'current'):
            raise ValueError('existing_skill_preserved')
    config = root / 'bindings.json'
    if config.exists() or config.is_symlink():
        if config.is_symlink() or json.loads(config.read_text()) != binding or stat.S_IMODE(config.stat().st_mode) != 0o600:
            raise ValueError('existing_bindings_preserved_review_required')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    existing_private_directory(root)
    releases = root / 'releases'
    releases.mkdir(mode=0o700, exist_ok=True)
    existing_private_directory(releases)
    approvals = root / 'approvals'
    approvals.mkdir(mode=0o700, exist_ok=True)
    existing_private_directory(approvals)
    release = releases / version
    manifest = {'schema': 1, 'version': version, 'files': hashes, 'default_dispatch': 'deny', 'live_collaboration': 'unverified'}
    if release.exists() or release.is_symlink():
        existing_private_directory(release)
        if json.loads((release / 'manifest.json').read_text()) != manifest or any((release / name).is_symlink() or (release / name).read_bytes() != raw for name, raw in files.items()):
            raise ValueError('existing_release_changed_preserved')
    else:
        stage = Path(tempfile.mkdtemp(prefix='.registration-', dir=releases))
        try:
            for name, raw in files.items():
                (stage / name).write_bytes(raw)
            (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            os.rename(stage, release)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    if not config.exists():
        fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(json.dumps(binding, ensure_ascii=False, indent=2) + '\n')
    managed = root / 'managed.json'
    if not managed.exists():
        with managed.open('x') as stream:
            json.dump({'manager': MANAGER, 'no_credentials': True, 'legacy_helper_replaced': False}, stream)
    current = root / 'current'
    previous = None
    if current.exists() or current.is_symlink():
        if not current.is_symlink() or current.resolve().parent != releases:
            raise ValueError('unmanaged_current_preserved')
        previous = os.readlink(current)
    temporary = root / '.current-new'
    if temporary.exists() or temporary.is_symlink():
        raise ValueError('prior_incomplete_registration_requires_review')
    temporary.symlink_to(release)
    os.replace(temporary, current)
    if not skill.is_symlink():
        if not skill.parent.is_dir() or skill.parent.is_symlink():
            raise ValueError('existing_giselle_skills_directory_required')
        skill.symlink_to(current)
    return {'version': version, 'release': str(release), 'skill': str(skill), 'previous_current': previous, 'first_registration': not prior, 'bound_profiles': sorted(binding['teams']), 'default_dispatch': 'deny', 'approval_files_created': 0, 'model_calls': 0, 'service_changes': 0, 'live_collaboration': 'unverified'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approved-roots', required=True, type=Path)
    parser.add_argument('--seat-inventory', required=True, type=Path)
    args = parser.parse_args()
    result = install(Path.home(), Path(__file__).parent, json.loads(args.approved_roots.read_text()), json.loads(args.seat_inventory.read_text()))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
