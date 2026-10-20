# Vendored kokosync JS SDK

Source: https://github.com/katteni-kaihatu/kokosync (`sdk/js/`).
Copied on 2026-10-21 from commit `b55ed5d0ad5beb7f64161d904294b40fc442f69b`, including reliable peer delivery.

Original SHA-256:

- `index.js`: `68501ba623dc3f0183206474a28d458599b2ac6364d7878a75ed52398714e915`
- `index.d.ts`: `7276226b4189755f33dd9961874aee68146f47b45bfb934e2c9ee9db4de3b845`
- `fragmentation.js`: `cf1fc623a11e08e0db471ae25e8fc9fc2c9e5df83e3ed984867cea40391aa434`
- `routing.js`: `2aee5dd003a9312d55ccc0c906711343710007b7633922c4dbc041cd74484b37`
- `peer-delivery.js`: `8b869bcb44371e9c20be27ce6ba31be9d81015c794c3c91f941789fb8dab8d90`

Local adapter changes in `index.js` / `index.d.ts`:

- `offerUrl` and `offerHeaders` route browser signaling through the authenticated Tonarium endpoint.
- `websocketUrl` and `websocketFactory` support the browser fallback proxy and Node's `ws` Basic authentication.
- `connectTimeout` separates the short WebRTC connection attempt from the longer request/transfer timeout.

The wire protocol, fragmentation and routing implementations are unchanged from this snapshot. Tonarium selects up to five direct peers from its authorized membership list. Runtime dependencies are pinned by Tonarium's package lock. When updating, retain these hooks or replace them with equivalent upstream options, and rerun `test:sync` plus the opt-in integration test.
