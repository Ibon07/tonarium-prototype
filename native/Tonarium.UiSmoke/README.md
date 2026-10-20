# Native UI normal-flow smoke

Run against an isolated development server with KokoSync enabled:

```powershell
dotnet run --project native/Tonarium.UiSmoke -- http://localhost:3015 native/Tonarium.UiSmoke/results
```

The suite uses the production `MainWindow`, `HomeView`, `RoomView`, item windows and profile windows. It sends real text-input and Enter-key events, raises real button Click events, and verifies resulting operations against a second native network client. Unique session and profile names avoid modifying existing content. Remembered login identity is not changed; generated test sessions are retained for inspection.

It renders Skia screenshots of login, all seven home navigation destinations, group/event creation, the event calendar, session creation, room/chat, inventory, note editing, social DM, profiles, 1000×640 minimum room/home layouts, 150% DPI and the return home. `result.json` lists network/control assertions and persistent controls that extend outside each window. Scrollable content is intentionally excluded from the outer-window bounds assertion.

This is a happy-path integration smoke, not a failure-case unit suite. Headless input does not validate physical Windows IME composition, foreground window switching, GPU surfaces, microphone devices or Unity rendering; those require the separate runtime smoke.
