#!/usr/bin/env python3
"""Package a published .NET client with its matching Unity player."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('runtime', choices=['linux-x64', 'win-x64'])
parser.add_argument('published', type=Path)
parser.add_argument('unity', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
linux = args.runtime == 'linux-x64'
player = 'Tonarium3D.x86_64' if linux else 'Tonarium3D.exe'
for path in [args.published / ('Tonarium' if linux else 'Tonarium.exe'),
             args.published / 'Tonarium.dll', args.unity / player,
             args.unity / ('UnityPlayer.so' if linux else 'UnityPlayer.dll'),
             args.unity / 'Tonarium3D_Data/globalgamemanagers']:
    if not path.is_file():
        raise SystemExit(f'Missing build output: {path}')
root = Path(__file__).resolve().parent.parent
shutil.copytree(args.unity, args.published / 'Unity', dirs_exist_ok=True)
for unused in ['win-x86', 'win-arm64']:
    folder = args.published / 'libvlc' / unused
    if folder.is_dir():
        shutil.rmtree(folder)
for symbols in args.published.rglob('*.pdb'):
    symbols.unlink()
if linux:
    for executable in ['Tonarium', 'Unity/' + player]:
        (args.published / executable).chmod(0o755)
    shutil.copy2(root / 'packaging/linux/tonarium.desktop', args.published)
    shutil.copy2(root / 'client/public/brand/favicon.png', args.published / 'tonarium.png')
shutil.copy2(root / ('docs/native-linux.md' if linux else 'docs/native-windows.md'),
             args.published / 'README-native.md')
metadata = {
    'channel': 'nightly', 'runtime': args.runtime,
    'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'run': os.environ.get('GITHUB_RUN_ID'),
    'unity': (root / 'native/Tonarium.Unity/ProjectSettings/ProjectVersion.txt').read_text().splitlines()[0],
}
(args.published / 'release.json').write_text(json.dumps(metadata, indent=2) + '\n')
args.output.mkdir(parents=True, exist_ok=True)
archive = Path(shutil.make_archive(str(args.output / f'Tonarium-nightly-{args.runtime}'),
                                  'gztar' if linux else 'zip',
                                  root_dir=args.published.parent, base_dir=args.published.name))
with archive.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
archive.with_name(archive.name + '.sha256').write_text(f'{digest}  {archive.name}\n')
print(archive)
