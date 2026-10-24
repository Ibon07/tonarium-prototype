"""Exercise the Unity Survivors HUD, movement and rendering through a local bridge."""
import copy
import json
import pathlib
import socket
import subprocess
import sys
import threading
import time

output = pathlib.Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
player = pathlib.Path(sys.argv[2]).resolve()
messages, checks = [], []
process = connection = None
listener = socket.socket()
listener.bind(('127.0.0.1', 0))
listener.listen(1)
listener.settimeout(60)


def state():
    try:
        return json.loads((output / 'survivor-state.json').read_text())
    except (FileNotFoundError, ValueError):
        return {}


def wait(predicate, description, seconds=12):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Unity exited: ' + description)
        if predicate():
            checks.append(description)
            print('PASS ' + description, flush=True)
            return
        time.sleep(.05)
    raise RuntimeError(description + ': ' + json.dumps(state(), ensure_ascii=False))


def send(message):
    connection.sendall((json.dumps(message) + '\n').encode())


def sent(kind, **values):
    return any(message.get('message', {}).get('t') == kind and all(message['message'].get(k) == v for k, v in values.items()) for message in messages if message.get('t') == 'room')


def click(name):
    # Web同様の右側パネルをスクロールし、画面内にある操作だけをクリックする。
    subprocess.run(['xdotool', 'mousemove', '--window', window, '1100', '400'], check=True)
    for direction in (4, 5):
        for _ in range(24):
            rect = state().get('controls', {}).get(name)
            if rect and 95 < rect['y'] and rect['y'] + rect['height'] < state().get('height', 800) - 60:
                break
            subprocess.run(['xdotool', 'click', str(direction)], check=True)
            time.sleep(.06)
        else:
            continue
        break
    wait(lambda: name in state().get('controls', {}), 'HUD has ' + name)
    time.sleep(.25)  # layout/scroll clamp is committed on the next Unity repaint
    rect = state()['controls'][name]
    subprocess.run(['xdotool', 'mousemove', '--window', window, str(round(rect['x'] + rect['width'] / 2)), str(round(rect['y'] + rect['height'] / 2))], check=True)
    time.sleep(.1)
    subprocess.run(['xdotool', 'click', '1'], check=True)
    time.sleep(.2)


def key_hold(key, seconds=.4):
    subprocess.run(['xdotool', 'keydown', key], check=True)
    try:
        time.sleep(seconds)
    finally:
        subprocess.run(['xdotool', 'keyup', key], check=True)
    time.sleep(.1)


def capture(name):
    (output / name).unlink(missing_ok=True)
    (output / 'survivor-command.json').write_text(json.dumps({'capture': name}))
    wait(lambda: (output / name).exists(), 'Rendered screenshot ' + name)


def profile():
    return dict(points=6, upgrades=dict(might=1, vitality=0, haste=0), runs=0, bestLevel=0, bestKills=0, achievements=[], discovered=['moonblade'])


def run_state():
    return dict(run=0, phase='lobby', startedAt=0, endedAt=None, pausedAt=None, players={}, enemies=[], effects=[], stylePicks={}, kills=0, spawnIndex=0, nextSpawnAt=0, randomSeed=1, bossDefeated=False)


def person(identifier, x, z):
    return dict(id=identifier, name=identifier, style='bloodrose', x=x, z=z, hp=120, maxHp=120, level=1, xp=0, nextXp=12, alive=True, kills=0, gear={'moonblade': 1}, choiceQueue=[], hitAt=0, attackAt={}, moveAt=int(time.time() * 1000))


def snapshot(survivor, sid='survivor-fixture', position=None):
    return dict(t='snapshot', selfId='probe-self', name='probe-self', sessionId=sid, serverUrl='http://127.0.0.1:1', now=int(time.time() * 1000), world='survivors',
                users=[dict(id='probe-ally', name='probe-ally', mode='3d', session=sid)], presence={}, items=[], chats=[],
                avatars={'probe-self': position or dict(x=4, z=2, ry=0), 'probe-ally': dict(x=1, z=-1, ry=0)}, survivor=survivor, survivorProfile=profile(),
                game=dict(round=99, phase='running', players=[{'id': 'probe-self'}], tiles={}))


try:
    for filename in ('survivor-state.json', 'survivor-command.json'):
        (output / filename).unlink(missing_ok=True)
    process = subprocess.Popen([str(player), '--tonarium-port', str(listener.getsockname()[1]), '--tonarium-survivor-probe', '--tonarium-hud-probe', '--tonarium-output', str(output), '-screen-width', '1280', '-screen-height', '800', '-screen-fullscreen', '0', '-force-glcore', '-logFile', str(output / 'player.log')])
    connection, _ = listener.accept()
    connection.settimeout(None)

    def receive():
        for line in connection.makefile():
            messages.append(json.loads(line))

    threading.Thread(target=receive, daemon=True).start()
    window = subprocess.check_output(['xdotool', 'search', '--sync', '--onlyvisible', '--pid', str(process.pid)], text=True, timeout=30).splitlines()[0]
    subprocess.run(['xdotool', 'windowfocus', '--sync', window], check=True)
    send(snapshot(run_state()))
    wait(lambda: state().get('world') == 'survivors' and state().get('focused') and 'start' in state().get('controls', {}), 'Snapshot opens Survivors HUD')
    wait(lambda: abs(state()['position']['x'] - 4) < .01 and abs(state()['position']['z'] + 2) < .01, 'Ordinary game state cannot overwrite Survivors spawn')
    click('start')
    assert not sent('survivorStart'), 'Start must be disabled outside the join area'
    checks.append('Start is disabled outside the join area')
    click('style:wraith')
    wait(lambda: sent('survivorStyle', style='wraith'), 'Style button sends room command')
    click('upgrade:might')
    wait(lambda: sent('survivorUpgrade', upgrade='might'), 'Permanent upgrade sends room command')
    click('reset')
    assert not sent('survivorReset'), 'Reset requires confirmation'
    click('reset')
    wait(lambda: sent('survivorReset'), 'Confirmed reset sends room command')
    click('library')
    capture('lobby.png')
    click('libraryClose')
    send({'t': 'teleport', 'x': 0, 'z': 6.5, 'ry': 0})
    wait(lambda: abs(state()['position']['z'] + 6.5) < .01, 'Fixture places player in Web join circle')
    click('start')
    wait(lambda: sent('survivorStart'), 'Start button sends room command')

    running = run_state()
    running.update(run=1, phase='running', startedAt=int(time.time() * 1000), players={'probe-self': person('probe-self', 0, .55), 'probe-ally': person('probe-ally', 1, -1)},
                   enemies=[dict(id='ghoul', kind='ghoul', x=2, z=1, radius=.3, hp=20, maxHp=20), dict(id='boss', kind='boss', x=-2, z=-1, radius=.8, hp=1000, maxHp=1000)],
                   effects=[dict(id='attack-1', playerId='probe-self', gear='moonblade', at=int(time.time() * 1000), **{'from': {'x': 0, 'z': .55}}, targets=[{'x': 2, 'z': 1}], reach=2.1)])
    send({'t': 'survivor', 'state': running})
    wait(lambda: state().get('enemies') == 2 and state().get('people') == 2 and state().get('effects', 0) > 0, 'State delta renders enemies, both players and attack')
    wait(lambda: abs(state()['position']['z'] + .55) < .01 and state()['cameraLocalPosition']['y'] == 16 and state()['cursor'] == 'None', 'New run resets local position and uses unlocked overhead camera')
    wait(lambda: state()['visibleAvatars'] == 1, 'Ordinary avatars remain visible like Web Avatar3D')
    capture('running.png')
    before = state()['position']['z']
    key_hold('w')
    wait(lambda: state()['position']['z'] > before + .5, 'WASD moves player in overhead screen direction')
    wait(lambda: any(m.get('message', {}).get('t') == 'avatar' and m['message']['s']['z'] < .05 for m in messages), 'Movement reaches avatar room command')
    wait(lambda: state().get('effects') == 0, 'Attack effects expire after rendering')
    send({'t': 'survivor', 'state': running})
    time.sleep(.2)
    assert state()['effects'] == 0, 'Repeated state must not replay an old attack'
    checks.append('Repeated state does not replay old attack effects')
    subprocess.run(['xdotool', 'mousemove', '--window', window, '42', '42', 'click', '1'], check=True)
    wait(lambda: state()['menu'] and not state()['controls'], 'Menu releases Survivors HUD controls')
    before = state()['position'].copy()
    key_hold('w')
    assert state()['position'] == before, 'Menu must block player movement'
    checks.append('Menu blocks player movement')
    key_hold('Escape', .15)
    wait(lambda: not state()['menu'], 'Escape closes menu')
    key_hold('Return', .15)
    wait(lambda: state()['chatOpen'], 'Enter opens chat above Survivors scene')
    before = state()['position'].copy()
    key_hold('d')
    assert state()['position'] == before, 'Chat entry must block player movement'
    checks.append('Chat entry blocks player movement')
    key_hold('Escape', .15)
    wait(lambda: not state()['chatOpen'], 'Escape closes chat')

    paused = copy.deepcopy(running)
    paused.update(pausedAt=int(time.time() * 1000), effects=[])
    paused['players']['probe-self']['choiceQueue'] = [['starbolt', 'ironheart']]
    send({'t': 'survivor', 'state': paused})
    wait(lambda: 'choose:starbolt' in state().get('controls', {}), 'Level-up choices appear from state delta')
    before = state()['position'].copy()
    key_hold('w')
    assert state()['position'] == before, 'Paused player must not move'
    checks.append('Shared choice pause blocks movement')
    capture('choices.png')
    click('choose:starbolt')
    wait(lambda: sent('survivorChoose', gear='starbolt'), 'Gear button sends selected choice')
    resumed = copy.deepcopy(paused)
    resumed['pausedAt'] = None
    resumed['players']['probe-self']['choiceQueue'] = []
    resumed['enemies'] = [dict(resumed['enemies'][0], x=3)]
    send({'t': 'survivor', 'state': resumed})
    wait(lambda: 'choose:starbolt' not in state().get('controls', {}), 'Resume removes choice HUD')
    wait(lambda: state()['enemies'] == 1 and abs(state()['markers']['ghoul']['x'] - 3) < .01 and 'boss' not in state()['markers'], 'State delta moves surviving enemy and removes defeated enemy')
    before = state()['position']['x']
    key_hold('d')
    wait(lambda: state()['position']['x'] > before + .5, 'Movement resumes after gear choice')

    ended = copy.deepcopy(running)
    ended.update(phase='ended', enemies=[], effects=[], endedAt=int(time.time() * 1000))
    ended['players']['probe-self']['alive'] = False
    send({'t': 'survivor', 'state': ended})
    wait(lambda: state()['enemies'] == 0 and state()['markers']['probe-self']['active'], 'End removes enemies and keeps defeated player visible')
    send({'t': 'world', 'world': 'room'})
    wait(lambda: state()['world'] == 'room' and state()['enemies'] == 0 and state()['people'] == 0 and state()['effects'] == 0 and not state()['controls'], 'World switch cleans Survivors HUD, enemies and attacks')
    wait(lambda: abs(state()['cameraLocalPosition']['y'] - 1.6) < .01 and state()['visibleAvatars'] == 1, 'World switch restores eye height and ordinary avatars')
    send({'t': 'world', 'world': 'survivors'})
    send({'t': 'survivor', 'state': ended})
    wait(lambda: state()['world'] == 'survivors' and state()['state'].get('phase') == 'ended' and state()['people'] == 2, 'Re-enter restores retained ended run')
    send(snapshot(run_state(), sid='survivor-fixture-2', position=dict(x=3, z=4, ry=0)))
    wait(lambda: state()['sessionId'] == 'survivor-fixture-2' and state()['people'] == 0 and abs(state()['position']['x'] - 3) < .01 and abs(state()['position']['z'] + 4) < .01, 'Same-world session snapshot clears previous run and restores new position')
    result = dict(ok=True, checks=checks, unity=state()['unity'], realUnityPlayer=True, bridge='127.0.0.1 fixture', productionServerUsed=False)
    (output / 'survivor-check.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    send({'t': 'shutdown'})
    process.wait(timeout=15)
    assert process.returncode == 0
except Exception as error:
    (output / 'survivor-check.json').write_text(json.dumps(dict(ok=False, error=str(error), checks=checks), ensure_ascii=False, indent=2) + '\n')
    raise
finally:
    (output / 'messages.json').write_text(json.dumps(messages, ensure_ascii=False, indent=2) + '\n')
    if connection is not None:
        connection.close()
    listener.close()
    if process is not None and process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
