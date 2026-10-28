import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NpcChat } from '../server/npc.ts';
import { NPC_PUBLIC, type NpcLocale } from '../shared/npc.ts';
import { runSmoke } from './fantasy-ai-smoke.mjs';

const cases: { npcId: string; questions: Record<NpcLocale, string> }[] = [
  { npcId: 'oldwatch-orran', questions: {
    ko: '오늘 좀 외로워. 얘기해 줄래?',
    en: 'I feel a little lonely today. Would you talk with me?',
    ja: '今日は少し寂しいんだ。話し相手になってくれる？',
  } },
  { npcId: 'rin', questions: {
    ko: '잠을 잘 못 잤는데 오늘도 일을 해야 해. 무리하지 않으려면 어떻게 할까?',
    en: 'I slept poorly but still have to work today. How would you avoid overdoing it?',
    ja: 'よく眠れなかったけど、今日も仕事があるんだ。無理をしないためにはどうしたらいいと思う？',
  } },
  { npcId: 'borin', questions: {
    ko: '새로운 일을 배우면 실수할까 봐 긴장돼. 너라면 어떻게 시작하겠어?',
    en: 'I feel nervous about making mistakes when learning a new trade. How would you begin?',
    ja: '新しい仕事を覚える時、失敗しそうで緊張するんだ。君ならどう始める？',
  } },
];

type Request = (payload: Record<string, unknown>) => Promise<unknown>;
export interface NpcSample {
  npcId: string; name: string; locale: NpcLocale; question: string; answer: string;
  model: string; source: string; temperature: number; maxTokens: number;
}

export async function sampleNpcDialogue(request: Request, model: string, log: (line: string) => void = console.log): Promise<NpcSample[]> {
  const samples: NpcSample[] = [];
  log('NPC samples use synthetic dialogue only. Review meaning, grammar and persona manually; transport success is not a quality verdict. CPU Q8 output does not establish browser Q4 quality.');
  for (const { npcId, questions } of cases) for (const locale of ['ko', 'en', 'ja'] as const) {
    let generation: Record<string, unknown> | undefined;
    const chat = new NpcChat({
      url: 'http://127.0.0.1:8080/v1', model, timeoutMs: 90_000,
      fetch: (async (_url, init) => {
        generation = JSON.parse(String(init?.body));
        const response = await request(generation!);
        if (!response || typeof response !== 'object' || !('model' in response) || response.model !== model) throw new Error('NPC sample returned an unexpected model.');
        return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch,
      onError: (error) => log(`NPC_SAMPLE_ERROR ${npcId}/${locale}: ${String(error).slice(0, 240)}`),
    });
    const reply = await chat.chat(`synthetic-sample-${npcId}-${locale}`, {
      requestId: `sample-${npcId}-${locale}`, npcId, locale, text: questions[locale],
    });
    if (reply.error || reply.source !== 'local' || !reply.text.trim() || !generation) throw new Error(`NPC sample ${npcId}/${locale} did not produce live spoken content (${reply.error ?? reply.source}).`);
    const sample: NpcSample = {
      npcId, name: NPC_PUBLIC.find(npc => npc.id === npcId)!.name[locale], locale,
      question: questions[locale], answer: reply.text, model: reply.model, source: reply.source,
      temperature: generation.temperature as number, maxTokens: generation.max_tokens as number,
    };
    samples.push(sample);
    log(`NPC_SAMPLE ${JSON.stringify(sample)}`);
  }
  log(`Collected ${samples.length} live NPC samples for human review; no automatic language-quality claim was made.`);
  return samples;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('NPC sampling cancelled.'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  runSmoke({
    signal: controller.signal, stateFile: process.env.FANTASY_AI_SMOKE_STATE_FILE,
    onReady: ({ request, model }: { request: Request; model: string }) => sampleNpcDialogue(request, model),
  }).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  });
}
