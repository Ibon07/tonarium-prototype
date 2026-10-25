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
    process = subprocess.Popen([str(player), '--tonarium-port', str(listener.getsockname()[1]), '--tonarium-survivor-probe', '--tonarium-output', str(output), '-screen-width', '1280', '-screen-height', '800', '-screen-fullscreen', '0', '-force-glcore', '-logFile', str(output / 'player.log')], stdout=subprocess.DEVNULL)
    connection, _ = listener.accept()
    def receive():
        for line in connection.makefile(): messages.append(json.loads(line))
    threading.Thread(target=receive, daemon=True).start()
    window = subprocess.check_output(['xdotool', 'search', '--sync', '--onlyvisible', '--pid', str(process.pid)], text=True, timeout=30).splitlines()[0]
    subprocess.run(['xdotool', 'windowfocus', '--sync', window], check=True)
    send(snapshot(run_state(), position=dict(x=0, z=6.5, ry=0)))
    wait(lambda: state().get('world') == 'survivors', 'Lobby fixture loaded')
    capture('3d-lobby.png')
    running = json.loads(pathlib.Path(__file__).with_name('survivor-parity-fixture.json').read_text())
    checks.append('Lobby uses Web first-person camera')
    assert abs(state()['cameraLocalPosition']['y']-1.6)<.01
    now=int(time.time()*1000)
    running['startedAt']=now-10000
    running['effects'][0]['at']=now
    send({'t':'survivor','state':running})
    (output / 'survivor-command.json').write_text(json.dumps({'visualNow':now+200}))
    wait(lambda: state().get('enemies') == 4 and state().get('effects', 0)>0, 'Web fixture renders four enemy kinds and area attack')
    capture('3d-running.png')
    geometry=state()['markers']
    assert any(p['mesh']=='Three.js ico0' for p in geometry['ghoul']['parts'])
    assert any(p['mesh']=='Three.js dodeca1' for p in geometry['boss']['parts'])
    assert any(p['name']=='Head' and p['mesh']=='Three.js head' for p in geometry['probe-self']['parts'])
    checks.append('Player head, enemy and boss use original Three.js geometry')
    gear_colors=['moonblade','eclipse','bloodaura','crimsonsun','starbolt','starfall','shade','umbralstorm']
    for index, gear in enumerate(gear_colors):
        stamp=int(time.time()*1000)
        running['effects']=[dict(id='gear-'+gear,playerId='probe-self',gear=gear,at=stamp,**{'from':{'x':0,'z':.55}},targets=[{'x':2,'z':1}],reach=2.1)]
        (output / 'survivor-command.json').write_text(json.dumps({'visualNow':stamp+200}))
        send({'t':'survivor','state':running})
        time.sleep(.15)
        capture('attack-'+gear+'.png')
    paused=copy.deepcopy(running);paused['effects']=[];paused['pausedAt']=int(time.time()*1000)
    paused['players']['probe-self']['choiceQueue']=[['starbolt','shade','ironheart']]
    send({'t':'survivor','state':paused})
    wait(lambda: 'choose:starbolt' in state().get('controls',{}),'Web choices fixture loaded')
    capture('3d-choices.png')
    (output/'parity-check.json').write_text(json.dumps(dict(ok=True,checks=checks),ensure_ascii=False,indent=2))
    send({'t':'shutdown'});process.wait(timeout=15)
finally:
    if connection is not None: connection.close()
    listener.close()
    if process is not None and process.poll() is None: process.terminate();process.wait(timeout=10)
