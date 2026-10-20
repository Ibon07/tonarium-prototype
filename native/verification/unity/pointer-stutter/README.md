# Unity pointer capture

2026-10-21: Windows embedded player investigation.

- Baseline human test reproduced the hitch, without a frame above 33 ms. The native clip stayed at the full Unity client rectangle. This did not establish a conflict between two clipping loops.
- The first relative-input comparison was invalid: it selected a hidden auxiliary Unity window, so relative input never activated.
- The host now supplies the actual embedded HWND. `relative-capture-verified.json` records 3,055 samples over five seconds, all at the same one-pixel center clip, with Unity retaining focus.
- The user subsequently confirmed that the mouse hitch was resolved. This is a manual observation, not a claim that every source of frame latency is eliminated.

The other JSON files retain the baseline frame/capture measurements and native capture checks. Input diagnostics are opt-in and buffer samples until shutdown.
