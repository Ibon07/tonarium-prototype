# Vendored kokosync JS SDK

Source: https://github.com/katteni-kaihatu/kokosync (`sdk/js/`).
Copied on 2026-10-21 from the local implementation after fragmentation updates.
The source checkout was based on `1f71d3762a581dace75e0f5788ef1112813a7721` with uncommitted SDK updates; the commit alone does not identify this copy.

Original SHA-256:

- `index.js`: `058ffaa377bd0c5762ceefb82cd56956360e61750bd2bcfbe756a0a2c0d46c29`
- `index.d.ts`: `8253746809cdf6bee3e34dee7e805b43b44b4fcff2f168228fbfd522c8332886`
- `fragmentation.js`: `21dfe60de08904e188520c098ac0f887ddff92a820bf559fe7f896c0c10a2317`

Local adapter changes in `index.js` / `index.d.ts`:

- `offerUrl` and `offerHeaders` route browser signaling through the authenticated Tonarium endpoint.
- `websocketUrl` and `websocketFactory` support the browser fallback proxy and Node's `ws` Basic authentication.
- `connectTimeout` separates the short WebRTC connection attempt from the longer request/transfer timeout.

The wire protocol and fragmentation implementation are unchanged. Runtime dependencies are pinned by Tonarium's package lock. When updating, retain these hooks or replace them with equivalent upstream options, and rerun `test:sync` plus the opt-in integration test.
