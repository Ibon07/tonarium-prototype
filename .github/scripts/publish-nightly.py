#!/usr/bin/env python3
"""Publish one independently built client/platform without replacing other assets."""
import argparse
import hashlib
import json
import os
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
    if component == 'native':
        names = [f'Tonarium-nightly-{runtime}' + ('.tar.gz' if runtime == 'linux-x64' else '.zip')]
    elif runtime == 'linux-x64':
        names = ['Tonarium-Electron-nightly-linux-x64.tar.gz', 'Tonarium-Electron-nightly-linux-x86_64.AppImage']
    else:
        names = ['Tonarium-Electron-nightly-win-x64.zip']
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
        gh('release', 'upload', 'nightly', *assets, '--clobber')
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
