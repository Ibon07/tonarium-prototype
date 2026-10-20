import { WebSocket, type WebSocketServer } from 'ws';

export function keepHomeSocketsAlive(server: WebSocketServer, intervalMs = 25_000) {
  const awaiting = new WeakSet<WebSocket>();
  const onPong = function (this: WebSocket) { awaiting.delete(this); };
  const onConnection = (socket: WebSocket) => socket.on('pong', onPong);
  server.on('connection', onConnection);
  const timer = setInterval(() => {
    for (const socket of server.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (awaiting.has(socket)) { socket.terminate(); continue; }
      awaiting.add(socket);
      // ブラウザのバックグラウンド時にも自動応答される制御フレームを使う。
      socket.ping(undefined, false, (error) => { if (error) socket.terminate(); });
    }
  }, intervalMs);
  timer.unref();
  const stop = () => {
    clearInterval(timer);
    server.off('connection', onConnection);
    for (const socket of server.clients) socket.off('pong', onPong);
    server.off('close', stop);
  };
  server.once('close', stop);
  return stop;
}
