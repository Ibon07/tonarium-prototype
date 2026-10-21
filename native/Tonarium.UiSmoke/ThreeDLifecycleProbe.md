# 3D lifecycle regression

Run the deterministic ownership and cleanup checks without a room server:

```powershell
$env:DOTNET_ROOT = Join-Path $env:LOCALAPPDATA 'Tonarium/dotnet'
& "$env:DOTNET_ROOT/dotnet.exe" run --project native/Tonarium.UiSmoke -- unused native/artifacts/3d-lifecycle-headless --3d-lifecycle
```

Add `--native-lifecycle` to use real Windows windows and the built Unity player.
The player must be available at `native/build/unity/Tonarium3D.exe`, or selected
with `TONARIUM_UNITY_PLAYER`. This opens temporary test windows and uses an
isolated preferences directory. It does not connect to a user's room server.

```powershell
& "$env:DOTNET_ROOT/dotnet.exe" run --project native/Tonarium.UiSmoke -c Release -- unused native/artifacts/3d-lifecycle-native --3d-lifecycle --native-lifecycle
```

The base checks cover owner-close traversal versus a direct HUD close, intentional
HUD detachment, repeated application/host stop requests joining the same task,
waiting for cleanup before closure, failed room sends over a closed WebSocket,
disposed Unity writers, session disconnect, and failed process startup.

The native checks additionally embed the real Unity player for 3D→2D, Unity-first
exit, session disconnect, app closure with a failed room connection, parent close,
HUD-focused `WM_SYSCOMMAND/SC_CLOSE` (the Alt+F4 close route), and closure during
startup. Each scenario verifies a single return notification, restored root,
detached HUD, and no surviving Unity child process. Physical keyboard delivery,
Windows logoff/shutdown and unrelated GPU/driver faults are outside these checks.

`result.json` records assertions. Expected communication-failure diagnostics are
written to `preferences/desktop.log` under the chosen output directory.

To check the real packaged app entry point, run an isolated development server
with its own `DATA_DIR`, then run the following. The script launches the app twice,
joins the given test session, closes the parent/HUD through their native close
routes three times in quick succession, and verifies exit code zero and no
surviving Unity child. `PlayerPath` can be omitted for a bundle with its own Unity
directory.

```powershell
./native/Tonarium.UiSmoke/Invoke-PackagedLifecycle.ps1 `
  -Executable native/artifacts/3d-lifecycle-release/Tonarium.exe `
  -Server http://127.0.0.1:3039 `
  -OutputDirectory native/artifacts/3d-lifecycle-packaged `
  -PlayerPath native/build/unity/Tonarium3D.exe
```
