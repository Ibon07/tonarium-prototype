import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { prepareModel } from './fantasy-ai-model.mjs';
import { npcSystemPrompt } from '../server/npc.ts';
import { NPC_PUBLIC, type NpcLocale } from '../shared/npc.ts';

const manifest = {
  filename: 'LFM3-1.7B-Q4_K_M.gguf', bytes: 1099627808,
  sha256: '3793e1e6e2266919d6e015287221b41100175a98eddaba92e111aed3b05c93c4',
  url: 'https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF/resolve/b3f2ae5d73cd3c91bf40e8ba752c648aa05dffdf/LFM3-1.7B-Q4_K_M.gguf',
};
const prompts: Record<NpcLocale, string[]> = {
  ko: ['오늘 좀 외로워. 얘기해 줄래?', '오늘 친구 미나와 다퉜어. 사과하고 싶은데 첫마디가 안 떠올라.', '방금 내가 누구와 무슨 일 때문에 고민한다고 했지?', '너도 어릴 때 친구와 싸운 적이 있어?'],
  en: ['I feel lonely today. Would you talk with me?', 'I argued with my friend Mina today. I want to apologize but cannot think of how to start.', 'Who did I just say I was worried about, and what happened?', 'Did you ever fight with a friend when you were a child?'],
  ja: ['今日は少し寂しいんだ。話し相手になってくれる？', '今日、友達のミナと喧嘩したんだ。謝りたいけど、最初に何と言えばいいか分からない。', 'さっき、誰とのどんな出来事で悩んでいると言った？', 'あなたも子供の頃に友達と喧嘩したことがある？'],
};
type Message = { role: 'system' | 'user' | 'assistant'; content: string };

async function main() {
  const binary = resolve(process.env.LFM3_BINARY ?? 'llama-server');
  const directory = await mkdtemp(join(tmpdir(), 'tonarium-lfm3-probe-'));
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15 * 60_000);
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let child: ReturnType<typeof spawn> | undefined;
  let stderr = '', peakRssKb = 0;
  let exited: Promise<unknown> | undefined;
  const samples: unknown[] = [];
  try {
    const prepared = await prepareModel({ directory, manifest, signal: controller.signal });
    child = spawn(binary, ['--model', prepared.path, '--alias', 'lfm3-1.7b', '--host', '127.0.0.1', '--port', '18743', '--ctx-size', '4096', '--parallel', '1', '--threads', '2', '--threads-batch', '2', '--n-gpu-layers', '0', '--jinja', '--reasoning', 'off', '--n-predict', '512'], {
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
      env: { ...process.env, LD_LIBRARY_PATH: `${dirname(binary)}:${process.env.LD_LIBRARY_PATH ?? ''}` },
    });
    let failure: Error | undefined;
    child.on('error', error => { failure = error; });
    exited = new Promise(resolveExit => child!.once('close', resolveExit));
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
    const endpoint = 'http://127.0.0.1:18743';
    let healthy = false;
    for (let i = 0; i < 120; i++) {
      controller.signal.throwIfAborted();
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error('LFM3 runtime exited during startup: ' + stderr);
      try { healthy = (await fetch(endpoint + '/health', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
      if (healthy) break;
      await pause(500, undefined, { signal: controller.signal });
    }
    if (!healthy) throw new Error('LFM3 runtime was not ready within 60 seconds. ' + stderr);
    const models = await (await fetch(endpoint + '/v1/models')).json() as { data?: { id: string }[] };
    if (!models.data?.some(model => model.id === 'lfm3-1.7b')) throw new Error('Unexpected runtime model');
    const npc = NPC_PUBLIC.find(npc => npc.id === 'oldwatch-orran')!;
    console.log('LFM3_CONFIG ' + JSON.stringify({ manifest, runtime: 'b11938', threads: 2, context: 4096, fullHistory: true, productionChanged: false, sampling: { temperature: .1, top_k: 50, repeat_penalty: 1.1, max_tokens: 512 } }));
    for (const locale of ['ko', 'en', 'ja'] as const) for (const arm of ['bare', 'minimal-npc', 'current-npc-prompt'] as const) {
      const history: Message[] = [];
      for (const [turn, question] of prompts[locale].entries()) {
        const system = arm === 'bare' ? { ko: '한국어로 자연스럽게 대화하세요.', en: 'Converse naturally in English.', ja: '日本語で自然に会話してください。' }[locale]
          : arm === 'minimal-npc' ? `Speak only ${ {ko:'Korean',en:'English',ja:'Japanese'}[locale] } as ${npc.name[locale]}, a ${npc.age}-year-old ${npc.role[locale]}. ${npc.personality[locale]} ${npc.speech[locale]} No childhood or past incidents are established. Do not invent them. Respond naturally to the visitor.`
          : npcSystemPrompt(locale, npc.id, 'stranger', {}, question);
        const messages: Message[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: question }];
        const started = performance.now();
        const response = await fetch(endpoint + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]), body: JSON.stringify({ model: 'lfm3-1.7b', messages, stream: false, temperature: .1, top_k: 50, repeat_penalty: 1.1, seed: 20261028, max_tokens: 512, chat_template_kwargs: { enable_thinking: false } }) });
        if (!response.ok) throw new Error(`LFM3 HTTP ${response.status}: ${(await response.text()).slice(0,1000)}`);
        const value = await response.json() as { model?: string; choices?: { finish_reason?: string; message?: { content?: string; reasoning_content?: string } }[]; usage?: unknown };
        if (value.model !== 'lfm3-1.7b') throw new Error('Unexpected completion model');
        const message = value.choices?.[0]?.message;
        const raw = message?.content ?? '';
        const answer = raw.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, '').replace(/<\/?think\b[^>]*>/gi, '').trim();
        const sample = { locale, arm, turn: turn + 1, question, answer, elapsedMs: Math.round(performance.now() - started), finishReason: value.choices?.[0]?.finish_reason, usage: value.usage, reasoningChars: (message?.reasoning_content?.length ?? 0) + raw.length - answer.length, system };
        samples.push(sample); console.log('LFM3_SAMPLE ' + JSON.stringify(sample));
        try { const status = await readFile(`/proc/${child.pid}/status`, 'utf8'); peakRssKb = Math.max(peakRssKb, Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0)); } catch {}
        if (!answer) break;
        history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
      }
    }
    const report = { model: manifest.filename, peakProcessRssBytes: peakRssKb * 1024, samples, note: 'CPU only; full history across all three arms. Current application history pruning/routing and browser ONNX not tested. Language quality requires manual review.' };
    if (process.env.LFM3_REPORT) await writeFile(process.env.LFM3_REPORT, JSON.stringify(report, null, 2));
    console.log('LFM3_SUMMARY ' + JSON.stringify({ samples: samples.length, peakProcessRssBytes: peakRssKb * 1024, empty: samples.filter((s: any) => !s.answer).length }));
  } finally {
    clearTimeout(deadline); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (child) { child.kill('SIGTERM'); await Promise.race([exited, pause(5000)]); if (child.exitCode === null) { child.kill('SIGKILL'); await exited; } }
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
