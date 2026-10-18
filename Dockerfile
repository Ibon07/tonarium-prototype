# Tonarium プロトタイプ: クライアントをビルドし、Node サーバー 1 つで配信する
# （HTTP・WebSocket・LiveKit トークン発行がすべて同じポート）

# ---- ビルド ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

# ---- 実行 ----
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    SERVER_PORT=3001
# サーバーは TypeScript を tsx でそのまま動かす（プロトタイプなのでビルド工程を増やさない）
COPY --from=build /app/node_modules ./node_modules
COPY package.json tsconfig.json channels.json ./
COPY shared ./shared
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SERVER_PORT || 3001) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/index.ts"]
