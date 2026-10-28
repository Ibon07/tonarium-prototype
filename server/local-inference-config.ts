export function resolveLocalInferenceUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.NPC_LLM_URL;
  const bundled = env.NPC_LLM_BUNDLED_URL?.trim();
  if (!bundled) return configured ?? 'http://127.0.0.1:18081/v1';
  if (!configured?.trim()) return bundled;
  try {
    const url = new URL(configured);
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.port === '18081' && ['/', '/v1', '/v1/', '/v1/chat/completions', '/chat/completions'].includes(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash) return bundled;
  } catch { /* 不正な設定も既存の接続先検証へ渡す。 */ }
  return configured;
}

export function resolveLocalInferenceModel(env: NodeJS.ProcessEnv = process.env, url = resolveLocalInferenceUrl(env)): string {
  const configured = env.NPC_LLM_MODEL;
  const bundledUrl = env.NPC_LLM_BUNDLED_URL?.trim();
  const bundledModel = env.NPC_LLM_BUNDLED_MODEL?.trim();
  if (bundledUrl && bundledModel && url === bundledUrl
    && (!configured?.trim() || configured === 'qwen3-1.7b' || configured === 'qwen3-4b')) return bundledModel;
  return configured ?? 'qwen3-8b';
}
