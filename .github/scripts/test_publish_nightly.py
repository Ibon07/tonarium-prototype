"""Offline release safety checks; never access GitHub or upload real assets."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('publish_nightly', Path(__file__).with_name('publish-nightly.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
SHA = 'a' * 40
ENV = {'GITHUB_SHA': SHA, 'GH_REPO': 'example/tonarium', 'GITHUB_REF': 'refs/heads/main',
       'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2'}
NAMES = {
    ('native', 'linux-x64'): ['Tonarium-nightly-linux-x64.tar.gz'],
    ('native', 'win-x64'): ['Tonarium-nightly-win-x64.zip'],
    ('electron', 'linux-x64'): ['Tonarium-Electron-nightly-linux-x64.tar.gz',
                                'Tonarium-Electron-nightly-linux-x86_64.AppImage'],
    ('electron', 'win-x64'): ['Tonarium-Electron-nightly-win-x64.zip'],
}


class FakeGitHub:
    def __init__(self, *, exists=True, create_fails=False, competitor=False,
                 currents=None, upload_fails=False, tag_fails=False):
        self.exists = exists
        self.create_fails = create_fails
        self.competitor = competitor
        self.currents = list(currents or [SHA])
        self.upload_fails = upload_fails
        self.tag_fails = tag_fails
        self.calls = []
        self.records = []

    def __call__(self, *args, check=True):
        self.calls.append(args)
        code, stdout = 0, ''
        if args[:2] == ('api', 'repos/example/tonarium/git/ref/heads/main'):
            stdout = self.currents.pop(0) if len(self.currents) > 1 else self.currents[0]
        elif args[:2] == ('release', 'view'):
            code = 0 if self.exists else 1
        elif args[:2] == ('release', 'create'):
            # Creation must not upload any archive or checksum.
            assert not any(arg.endswith(('.zip', '.tar.gz', '.AppImage', '.sha256')) for arg in args)
            notes = Path(args[args.index('--notes-file') + 1]).read_text()
            assert 'different commits' in notes
            code = int(self.create_fails)
            self.exists = not self.create_fails or self.competitor
        elif args[:3] == ('api', '--method', 'PATCH'):
            assert 'force=false' in args
            code = int(self.tag_fails)
        elif args[:2] == ('release', 'upload'):
            paths = [Path(arg) for arg in args[3:] if not arg.startswith('--')]
            assert all(path.is_file() for path in paths)
            if any(path.name.endswith('.build.json') for path in paths):
                self.records.extend((path.name, json.loads(path.read_text())) for path in paths)
            else:
                code = int(self.upload_fails)
        result = subprocess.CompletedProcess(args, code, stdout, 'simulated API error' if code else '')
        if code and check:
            raise subprocess.CalledProcessError(code, args, output=stdout, stderr=result.stderr)
        return result

    def uploads(self):
        return [args for args in self.calls if args[:2] == ('release', 'upload')]


class PublishTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.environment = patch.dict(os.environ, ENV)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def files(self, component='native', runtime='linux-x64'):
        hashes = {}
        for name in NAMES[component, runtime]:
            content = ('test archive ' + name).encode()
            (self.directory / name).write_bytes(content)
            digest = hashlib.sha256(content).hexdigest()
            (self.directory / (name + '.sha256')).write_text(f'{digest}  {name}\n')
            hashes[name] = digest
        return hashes

    def publish(self, fake, component='native', runtime='linux-x64'):
        with patch.object(publisher, 'gh', fake):
            publisher.publish(component, runtime, self.directory)

    def test_existing_release_and_metadata_for_all_four_variants(self):
        uploaded_names = set()
        for component, runtime in NAMES:
            with self.subTest(component=component, runtime=runtime):
                hashes = self.files(component, runtime)
                fake = FakeGitHub()
                self.publish(fake, component, runtime)
                self.assertEqual(len(fake.uploads()), 2)
                self.assertFalse(any(args[:2] == ('release', 'create') for args in fake.calls))
                name, record = fake.records[0]
                self.assertEqual(name, f'Tonarium-{component.capitalize()}-nightly-{runtime}.build.json')
                self.assertEqual(record, {
                    'channel': 'nightly', 'component': component, 'runtime': runtime,
                    'commit': SHA, 'run': '123', 'runAttempt': '2',
                    'runUrl': 'https://github.com/example/tonarium/actions/runs/123', 'sha256': hashes,
                })
                names = {Path(arg).name for args in fake.uploads() for arg in args[3:] if arg != '--clobber'}
                expected = set(hashes) | {item + '.sha256' for item in hashes} | {name}
                self.assertEqual(names, expected)
                self.assertFalse(uploaded_names & names)
                uploaded_names.update(names)
                self.assertFalse(any('delete' in args for args in fake.calls))

    def test_initial_release_creation(self):
        self.files()
        fake = FakeGitHub(exists=False)
        self.publish(fake)
        self.assertEqual(len(fake.records), 1)
        self.assertEqual(sum(args[:2] == ('release', 'create') for args in fake.calls), 1)

    def test_creation_race_accepts_other_successful_creator(self):
        self.files()
        fake = FakeGitHub(exists=False, create_fails=True, competitor=True)
        self.publish(fake)
        self.assertEqual(len(fake.records), 1)

    def test_real_creation_failure_is_not_swallowed(self):
        self.files()
        fake = FakeGitHub(exists=False, create_fails=True)
        with self.assertRaises(subprocess.CalledProcessError):
            self.publish(fake)
        self.assertFalse(fake.uploads())

    def test_obsolete_build_has_no_mutations(self):
        fake = FakeGitHub(currents=['b' * 40])
        self.publish(fake)
        self.assertEqual(len(fake.calls), 1)

    def test_main_changes_while_preparing_release(self):
        self.files()
        fake = FakeGitHub(currents=[SHA, 'b' * 40])
        self.publish(fake)
        self.assertFalse(fake.uploads())
        self.assertFalse(any('PATCH' in args for args in fake.calls))

    def test_invalid_checksum_prevents_release_mutations(self):
        self.files()
        next(self.directory.glob('*.sha256')).write_text('incorrect checksum\n')
        fake = FakeGitHub()
        with self.assertRaisesRegex(RuntimeError, 'Invalid checksum'):
            self.publish(fake)
        self.assertEqual(len(fake.calls), 1)

    def test_upload_failure_preserves_previous_completion_record(self):
        self.files()
        fake = FakeGitHub(upload_fails=True)
        with self.assertRaises(subprocess.CalledProcessError):
            self.publish(fake)
        self.assertEqual(len(fake.uploads()), 1)
        self.assertFalse(fake.records)

    def test_tag_failure_is_not_swallowed(self):
        self.files()
        fake = FakeGitHub(tag_fails=True)
        with self.assertRaisesRegex(RuntimeError, 'Cannot advance nightly tag'):
            self.publish(fake)
        self.assertFalse(fake.uploads())

    def test_newer_main_during_tag_update_skips_obsolete_assets(self):
        self.files()
        fake = FakeGitHub(tag_fails=True, currents=[SHA, SHA, 'b' * 40])
        self.publish(fake)
        self.assertFalse(fake.uploads())
        self.assertFalse(fake.records)

    def test_non_main_ref_is_rejected(self):
        with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/feature'}):
            with self.assertRaisesRegex(RuntimeError, 'restricted to main'):
                self.publish(FakeGitHub())


class WorkflowTests(unittest.TestCase):
    def workflow(self, name):
        try:
            import yaml
        except ImportError:
            self.skipTest('Workflow checks require PyYAML')
        return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)

    def test_native_checks_only_match_native_inputs(self):
        from fnmatch import fnmatchcase
        workflow = self.workflow('native-checks.yml')
        for event in ['push', 'pull_request']:
            paths = workflow['on'][event]['paths']
            for filename in ['native/Tonarium.Desktop/App.cs', 'packaging/linux/PKGBUILD',
                             'client/public/brand/favicon.png', 'client/public/oekaki/sample.png']:
                self.assertTrue(any(fnmatchcase(filename, pattern) for pattern in paths), filename)
            for filename in ['electron/main.cjs', 'client/src/App.tsx', 'docs/electron.md',
                             '.github/scripts/publish-nightly.py']:
                self.assertFalse(any(fnmatchcase(filename, pattern) for pattern in paths), filename)
        self.assertNotIn('nightly-config', workflow['jobs'])
        self.assertIn('nightly-config', self.workflow('nightly-checks.yml')['jobs'])

    def test_gameci_outputs_can_be_packaged_for_both_platforms(self):
        workflow = self.workflow('native-nightly.yml')
        steps = workflow['jobs']['native']['steps']
        prepare_index = next(i for i, step in enumerate(steps)
                             if step.get('name') == 'Prepare Unity output for packaging')
        self.assertIn('unity-builder@', steps[prepare_index - 1]['uses'])
        self.assertEqual(steps[prepare_index + 1]['name'], 'Publish .NET client')
        script = steps[prepare_index]['run']
        self.assertIn('sudo chown -R "$(id -u):$(id -g)" native/build', script)
        # Exercise the actual shell and packager with minimal GameCI-shaped fixtures.
        # Ownership itself needs the root-run GameCI container; stub only sudo here.
        for runtime, target, player, library in [
            ('linux-x64', 'StandaloneLinux64', 'Tonarium3D', 'UnityPlayer.so'),
            ('win-x64', 'StandaloneWindows64', 'Tonarium3D.exe', 'UnityPlayer.dll'),
        ]:
            with self.subTest(runtime=runtime), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                unity = root / 'native/build/nightly-unity' / target
                published = root / 'native/build/nightly' / runtime
                unity.mkdir(parents=True)
                published.mkdir(parents=True)
                for name in [player, library, 'Tonarium3D_Data/globalgamemanagers']:
                    path = unity / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('fixture')
                (unity / player).chmod(0o755)
                for name in ['Tonarium.dll', 'Tonarium' if runtime == 'linux-x64' else 'Tonarium.exe']:
                    (published / name).write_text('fixture')
                subprocess.run(['bash', '-eu', '-c', 'sudo() { :; };\n' + script], cwd=root,
                               env={**os.environ, 'RUNTIME': runtime, 'UNITY_TARGET': target}, check=True)
                result = subprocess.run(['python3', str(ROOT / 'native/package-nightly.py'), runtime,
                                         str(published), str(unity), str(root / 'artifacts')],
                                        check=True, capture_output=True, text=True)
                archive = Path(result.stdout.strip())
                self.assertTrue(archive.is_file())
                self.assertTrue(archive.with_name(archive.name + '.sha256').is_file())

    def test_all_four_builds_are_independent_with_distinct_writer_locks(self):
        try:
            import yaml
        except ImportError:
            self.skipTest('Optional local workflow structure check requires PyYAML')
        workflow = yaml.load((ROOT / '.github/workflows/native-nightly.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertNotIn('concurrency', workflow)
        jobs = workflow['jobs']
        self.assertTrue({'native', 'electron'} <= set(jobs))
        combinations, locks, artifacts = set(), set(), set()
        for component, job in jobs.items():
            if component not in {'native', 'electron'}:
                continue
            self.assertNotIn('needs', job)
            self.assertEqual(job['strategy']['fail-fast'], 'false')
            self.assertEqual(job['concurrency']['cancel-in-progress'], 'false')
            self.assertEqual(job['permissions']['contents'], 'write')
            self.assertIn('publish-nightly.py ' + component, job['steps'][-1]['run'])
            artifact = next(step['with']['name'] for step in job['steps'] if 'upload-artifact@' in step.get('uses', ''))
            for entry in job['strategy']['matrix']['include']:
                runtime = entry['runtime']
                combinations.add((component, runtime))
                locks.add(job['concurrency']['group'].replace('${{ matrix.runtime }}', runtime))
                artifacts.add(artifact.replace('${{ matrix.runtime }}', runtime))
        self.assertEqual(combinations, set(NAMES))
        self.assertEqual(len(locks), 4)
        self.assertEqual(len(artifacts), 4)


if __name__ == '__main__':
    unittest.main()
