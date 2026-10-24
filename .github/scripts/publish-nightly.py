#!/usr/bin/env python3
"""Publish one independently built client/platform without replacing other assets."""
import argparse
import base64
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile

NOTES = '''Native and Electron nightlies are built and published independently for each platform.

Each *.build.json records the source commit, workflow run and checksums for that client/platform.
An unavailable or failed build leaves its previous successful assets in place: assets may come from different commits.
The nightly tag can be newer than individual assets. Check the matching build metadata before downloading.

Linux native dependencies: see docs/native-linux.md. Electron usage: see docs/electron.md.
'''


def gh(*args, check=True):
    return subprocess.run(['gh', *args], check=check, capture_output=True, text=True)


def electron_assets(directory, runtime):
    import yaml
    channel = 'nightly-linux.yml' if runtime == 'linux-x64' else 'nightly.yml'
    info = yaml.safe_load((directory / channel).read_text())
    version = info.get('version', '')
    if not re.fullmatch(r'\d+\.\d+\.\d+-nightly\.\d+\.\d+', version):
        raise RuntimeError('Invalid Electron nightly version')
    platform = 'linux' if runtime == 'linux-x64' else 'win'
    prefix = f'Tonarium-Electron-{version}-{platform}-'
    names = sorted(file.name for file in directory.iterdir() if file.name.startswith(prefix)
                   and file.name.endswith(('.AppImage', '.tar.gz', '.zip', '.exe', '.blockmap')))
    expected = ['.AppImage', '.tar.gz'] if platform == 'linux' else ['-setup.exe', '.zip']
    if not all(any(name.endswith(extension) for name in names) for extension in expected):
        raise RuntimeError('Missing Electron nightly archives')
    entries = info.get('files', [])
    if not entries:
        raise RuntimeError('Missing updater files')
    for entry in entries:
        name = entry.get('url')
        if name not in names:
            raise RuntimeError('Updater metadata references an unexpected artifact')
        with (directory / name).open('rb') as stream:
            digest = base64.b64encode(hashlib.file_digest(stream, 'sha512').digest()).decode()
        if entry.get('sha512') != digest:
            raise RuntimeError('Updater SHA-512 mismatch')
    installer_suffix = '.AppImage' if platform == 'linux' else '-setup.exe'
    if not any(entry['url'].endswith(installer_suffix) for entry in entries):
        raise RuntimeError('Missing updater installer reference')
    if info.get('path') and info['path'] not in [entry['url'] for entry in entries]:
        raise RuntimeError('Invalid updater legacy path')
    return names + [channel], channel


def publish(component, runtime, directory):
    directory = Path(directory).resolve()
    sha = os.environ['GITHUB_SHA']
    repo = os.environ['GH_REPO']
    if os.environ['GITHUB_REF'] != 'refs/heads/main':
        raise RuntimeError('Nightly publishing is restricted to main')

    def current():
        return gh('api', f'repos/{repo}/git/ref/heads/main', '--jq', '.object.sha').stdout.strip() == sha

    if not current():
        print('A newer main exists; skipping this obsolete build.')
        return
    channel = None
    if component == 'native':
        names = [f'Tonarium-nightly-{runtime}' + ('.tar.gz' if runtime == 'linux-x64' else '.zip')]
    else:
        names, channel = electron_assets(directory, runtime)
    assets = []
    hashes = {}
    for name in names:
        file = directory / name
        if not file.is_file() or file.stat().st_size == 0:
            raise RuntimeError(f'Missing or empty build output: {name}')
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        checksum = directory / (name + '.sha256')
        if checksum.read_text().split() != [digest, name]:
            raise RuntimeError(f'Invalid checksum: {name}')
        hashes[name] = digest
        assets.extend([str(file), str(checksum)])

    # Creation can race with any of the other three publishing jobs. Never attach
    # assets to create: each job always uploads only its own namespace afterwards.
    with tempfile.TemporaryDirectory(prefix='tonarium-nightly-') as temporary:
        notes = Path(temporary) / 'notes.txt'
        notes.write_text(NOTES)
        if gh('release', 'view', 'nightly', check=False).returncode:
            created = gh('release', 'create', 'nightly', '--target', sha,
                         '--title', 'Tonarium nightly', '--notes-file', str(notes),
                         '--prerelease', '--latest=false', check=False)
            if created.returncode:
                # A concurrent successful creator is fine; authentication/network
                # failures without an existing release still fail the job.
                gh('release', 'view', 'nightly')
        if not current():
            print('Main changed while preparing release; skipping upload.')
            return
        # No force: a slower job must never rewind a tag already advanced by a
        # newer build of the other client. Same-family jobs are serialized in CI.
        moved = gh('api', '--method', 'PATCH', f'repos/{repo}/git/refs/tags/nightly',
                   '-f', f'sha={sha}', '-F', 'force=false', check=False)
        if moved.returncode:
            if not current():
                print('A newer main superseded this publication.')
                return
            raise RuntimeError(f'Cannot advance nightly tag: {moved.stderr}')
        gh('release', 'edit', 'nightly', '--title', 'Tonarium nightly',
           '--notes-file', str(notes), '--prerelease', '--latest=false')
        # バージョン付き本体を先に揃え、更新の入口である YAML を最後に切り替える。
        channel_assets = [asset for asset in assets if channel and Path(asset).name in (channel, channel + '.sha256')]
        gh('release', 'upload', 'nightly', *[asset for asset in assets if asset not in channel_assets], '--clobber')
        if channel_assets:
            gh('release', 'upload', 'nightly', *channel_assets, '--clobber')
        metadata = Path(temporary) / f'Tonarium-{component.capitalize()}-nightly-{runtime}.build.json'
        metadata.write_text(json.dumps({
            'channel': 'nightly', 'component': component, 'runtime': runtime,
            'commit': sha, 'run': os.environ['GITHUB_RUN_ID'],
            'runAttempt': os.environ.get('GITHUB_RUN_ATTEMPT', '1'),
            'runUrl': f'https://github.com/{repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}',
            'sha256': hashes,
        }, indent=2) + '\n')
        # Publish the completion record only after every archive/checksum upload
        # succeeds. Other client/platform assets and records are never removed.
        gh('release', 'upload', 'nightly', str(metadata), '--clobber')
    print(f'Published {component} {runtime} from {sha}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('component', choices=['native', 'electron'])
    parser.add_argument('runtime', choices=['linux-x64', 'win-x64'])
    parser.add_argument('directory')
    args = parser.parse_args()
    publish(args.component, args.runtime, args.directory)
