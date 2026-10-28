import assert from 'node:assert/strict';
import test from 'node:test';
import { NPC_PUBLIC } from '../shared/npc.ts';
import { sampleNpcDialogue, sampleNpcTranslations } from './fantasy-npc-samples.ts';

const model = 'qwen3-1.7b';
const response = (content: string, reportedModel = model) => ({
  model: reportedModel, choices: [{ message: { role: 'assistant', content } }],
});

test('NPC samples exercise actual live generation for three distinct speakers and locales without saved characters', async () => {
  const requests: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const before = JSON.stringify(NPC_PUBLIC);
  const samples = await sampleNpcDialogue(async payload => {
    requests.push(payload);
    return response('A bounded synthetic response for testing the sampling transport.');
  }, model, line => logs.push(line));
  assert.equal(requests.length, 12);
  assert.equal(samples.length, 9);
  assert.deepEqual([...new Set(samples.map(sample => sample.npcId))], ['oldwatch-orran', 'rin', 'borin']);
  assert.deepEqual([...new Set(samples.map(sample => sample.locale))], ['ko', 'en', 'ja']);
  for (const [index, sample] of samples.entries()) {
    const messages = requests[index].messages as { role: string; content: string }[];
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[0].content.includes(sample.name));
    assert.equal(messages.at(-1)!.content, sample.question);
    assert.equal(sample.source, 'local');
    assert.equal(sample.model, model);
    assert.equal(requests[index].stream, false);
    assert.deepEqual(requests[index].chat_template_kwargs, { enable_thinking: false });
    assert.ok(sample.maxTokens <= 256);
    assert.ok(sample.temperature >= 0 && sample.temperature <= 2);
  }
  assert.equal(JSON.stringify(NPC_PUBLIC), before);
  assert.equal(logs.filter(line => line.startsWith('NPC_SAMPLE ')).length, 9);
  const translations = logs.filter(line => line.startsWith('NPC_TRANSLATION_SAMPLE ')).map(line => JSON.parse(line.slice('NPC_TRANSLATION_SAMPLE '.length)));
  assert.equal(translations.length, 3);
  for (const [index, translation] of translations.entries()) {
    const payload = requests[index + 9];
    const messages = payload.messages as { role: string; content: string }[];
    assert.equal(payload.model, model);
    assert.equal(payload.temperature, 0.2);
    assert.equal(payload.max_tokens, 160);
    assert.equal(payload.stream, false);
    assert.deepEqual(payload.chat_template_kwargs, { enable_thinking: false });
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /Translate.*Korean/);
    assert.equal(messages[1].role, 'user');
    assert.equal(messages[1].content, translation.englishSource);
    assert.equal(translation.experimental, true);
    assert.equal(translation.originalKoQuestion, samples.find(sample => sample.npcId === translation.npcId && sample.locale === 'ko')!.question);
  }
  assert.match(logs[0], /CPU Q8.*browser Q4/);
});

test('translation comparison is optional and cannot turn an invalid translation into a sample', async () => {
  let requests = 0;
  const samples = await sampleNpcDialogue(async () => {
    requests++;
    return response('A synthetic response.');
  }, model, () => {}, { translationProbes: false });
  assert.equal(requests, 9);
  for (const completion of [response('<think>Unfinished thought'), response('번역', 'other-model'), { model, choices: [{ message: { role: 'user', content: '번역' } }] }]) {
    await assert.rejects(sampleNpcTranslations(samples, async () => completion, model, () => {}), /Translation probe/);
  }
  const logs: string[] = [];
  const translations = await sampleNpcTranslations(samples, async () => response('<think>Hidden reasoning.</think> 자연스러운 번역.'), model, line => logs.push(line));
  assert.equal(translations.length, 3);
  assert.equal(translations[0].translatedAnswer, '자연스러운 번역.');
  assert.equal(logs.filter(line => line.startsWith('NPC_TRANSLATION_SAMPLE ')).length, 3);
});

test('sampling fails rather than passing fallback text or an unexpected model as a live quality sample', async () => {
  for (const completion of [response(' ', model), response('Hello.', 'other-model'), response('I am an AI and NPC.')]) {
    await assert.rejects(sampleNpcDialogue(async () => completion, model, () => {}), /did not produce live spoken content/);
  }
});
