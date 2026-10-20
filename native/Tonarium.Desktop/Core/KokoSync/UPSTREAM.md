# KokoSync native client

Vendored from the user's sibling `kokosync/sdk/csharp/KokoSync` checkout on 2026-10-21.
The native client uses this SDK directly with Tonarium's authenticated `/sync/ws`
proxy, preserving the existing MessagePack and AES-GCM application protocol.

Local change: `Client.ConnectWebSocketAsync` accepts optional HTTP headers to set
the Origin header required by Tonarium's existing same-origin proxy check.

Dependencies: LiteNetLib 2.1.4 and MessagePack 3.1.12. No browser is used for state
synchronization. The native SDK's LiteNetLib adapter only permits loopback; the
remote server connection uses its WebSocket transport. Peer positions and peer
operation delivery are not requested; Tonarium's server supplies the compatible
relay path for both.
