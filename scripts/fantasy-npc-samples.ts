import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NpcChat } from '../server/npc.ts';
import { NPC_PUBLIC, type NpcLocale } from '../shared/npc.ts';
import { fantasyNpcTone } from '../shared/fantasy-dialogue-voice.ts';
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

export interface NpcTranslationSample {
  npcId: string; originalKoQuestion: string; englishSource: string; translatedAnswer: string;
  model: string; temperature: number; maxTokens: number; experimental: true;
}

export async function sampleNpcTranslations(samples: readonly NpcSample[], request: Request, model: string, log: (line: string) => void = console.log): Promise<NpcTranslationSample[]> {
  const translations: NpcTranslationSample[] = [];
  for (const { npcId } of cases) {
    const korean = samples.find(sample => sample.npcId === npcId && sample.locale === 'ko');
    if (!korean) throw new Error(`Missing Korean sample for ${npcId}.`);
    const chat = new NpcChat({
      url: 'http://127.0.0.1:8080/v1', model, timeoutMs: 90_000,
      fetch: (async (_url, init) => {
        const response = await request(JSON.parse(String(init?.body)));
        if (!response || typeof response !== 'object' || !('model' in response) || response.model !== model) throw new Error('Pivot draft returned an unexpected model.');
        return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch,
      onError: (error) => log(`NPC_SAMPLE_ERROR ${npcId}/pivot: ${String(error).slice(0, 240)}`),
    });
    const draft = await chat.chat(`synthetic-pivot-${npcId}`, {
      requestId: `pivot-${npcId}`, npcId, locale: 'en', text: korean.question,
    });
    if (draft.error || draft.source !== 'local' || draft.model !== model || !draft.text.trim()) throw new Error(`Pivot draft ${npcId} did not produce live spoken content with the expected model (${draft.error ?? draft.source}).`);
    const englishSource = draft.text.slice(0, 1200);
    log(`NPC_PIVOT_DRAFT_SAMPLE ${JSON.stringify({ npcId, originalKoQuestion: korean.question, englishDraft: englishSource, source: draft.source, model: draft.model, requestedLocale: 'en', experimental: true })}`);
    const tone = fantasyNpcTone(npcId);
    const register = ['trade', 'scholar', 'priest'].includes(tone) ? 'polite Korean (해요체)' : tone === 'leader' ? 'formal familiar Korean (하게체)' : 'informal Korean (반말)';
    const response = await request({
      model, stream: false, temperature: 0.2, max_tokens: 160,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: 'system', content: `Translate the supplied English dialogue into natural ${register}. Preserve its meaning, add nothing, and output only the Korean translation.` },
        { role: 'user', content: englishSource },
      ],
    });
    const completion = response as { model?: unknown; choices?: { message?: { role?: unknown; content?: unknown } }[] } | null;
    const message = completion?.choices?.[0]?.message;
    const translated = typeof message?.content === 'string' ? message.content.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, '').replace(/<\/?think\b[^>]*>/gi, '').trim().slice(0, 1200) : '';
    if (completion?.model !== model || message?.role !== 'assistant' || !translated) throw new Error(`Translation probe ${npcId} did not produce spoken content with the expected model.`);
    const sample: NpcTranslationSample = {
      npcId, originalKoQuestion: korean.question, englishSource, translatedAnswer: translated,
      model, temperature: 0.2, maxTokens: 160, experimental: true,
    };
    translations.push(sample);
    log(`NPC_TRANSLATION_SAMPLE ${JSON.stringify(sample)}`);
  }
  return translations;
}

export async function sampleNpcDialogue(request: Request, model: string, log: (line: string) => void = console.log, options: { translationProbes?: boolean } = {}): Promise<NpcSample[]> {
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
  if (options.translationProbes !== false) {
    log('Experimental pivot probes answer each original Korean question through NpcChat with the requested output locale set to English, then translate that draft into Korean. This is not a deployed two-pass pipeline.');
    await sampleNpcTranslations(samples, request, model, log);
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
