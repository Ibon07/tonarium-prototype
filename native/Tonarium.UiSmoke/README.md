# Native UI normal-flow smoke

Run against an isolated development server with KokoSync enabled:

```powershell
dotnet run --project native/Tonarium.UiSmoke -- http://localhost:3015 native/Tonarium.UiSmoke/results
```

The suite uses the production `MainWindow`, `HomeView`, `RoomView`, item windows and profile windows. It sends real text-input and Enter-key events, raises real button Click events, and verifies resulting operations against a second native network client. Unique session and profile names avoid modifying existing content. Remembered login identity is not changed; generated test sessions are retained for inspection.

It renders Skia screenshots of login, all seven home navigation destinations, group/event creation, the event calendar, session creation, room/chat, inventory, note editing, social DM, profiles, 1000×640 minimum room/home layouts, 150% DPI and the return home. `result.json` lists network/control assertions and persistent controls that extend outside each window. Scrollable content is intentionally excluded from the outer-window bounds assertion.

The portrait probe checks the original Oekaki model/animation channel counts, live idle pixel changes, speaking, a networked look-pitch update, server-backed custom texture upload, and ordinary manifest parameter changes. It exports deterministic normal/blink/speaking/pose images, animation frames and a five-second idle CPU/memory/raster-cost sample. Speaking is stimulated through the portrait's explicit media-state override; microphone transport is covered by the separate media smoke.

To encode the recorded original-model frames as a GIF, install Pillow and run:

```powershell
python -m pip install --target native/Tonarium.UiSmoke/.tools Pillow
python native/Tonarium.UiSmoke/encode_animation.py native/Tonarium.UiSmoke/results
```

The focused offline-profile regression avoids rerunning unrelated flows:

```powershell
dotnet run --project native/Tonarium.UiSmoke -c Release -- http://localhost:3015 native/Tonarium.UiSmoke/offline-results --offline-avatar
```

It persists a custom texture and nondefault manifest for a unique name absent from online users, opens the actual native profile by that name, and verifies the stored texture, parsed parameters and nonblank rendered preview.

The focused canvas check sends actual headless mouse input through `SharedDrawingCanvas`, verifies 50 ms batching, release flushing, single dots, and every received point's order. Start `node native/Tonarium.Smoke/canvas-delay-proxy.cjs 3020 http://localhost:3015 20`, then run:

```powershell
dotnet run --project native/Tonarium.UiSmoke -c Release -- http://localhost:3020 native/artifacts/canvas-batched --canvas-sync http://localhost:3015
```

This is a happy-path integration smoke, not a failure-case unit suite. Headless input does not validate physical Windows IME composition, foreground window switching, GPU surfaces, microphone devices or Unity rendering; those require the separate runtime smoke. Its CPU sample includes the test harness and Skia software rendering, so it is evidence about this run, not a hardware-independent performance guarantee.
