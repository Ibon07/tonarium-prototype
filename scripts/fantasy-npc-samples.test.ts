import assert from 'node:assert/strict';
import test from 'node:test';
import { NPC_PUBLIC } from '../shared/npc.ts';
import { sampleNpcDialogue } from './fantasy-npc-samples.ts';

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
  assert.equal(requests.length, 9);
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
  assert.match(logs[0], /CPU Q8.*browser Q4/);
});

test('sampling fails rather than passing fallback text or an unexpected model as a live quality sample', async () => {
  for (const completion of [response(' ', model), response('Hello.', 'other-model'), response('I am an AI and NPC.')]) {
    await assert.rejects(sampleNpcDialogue(async () => completion, model, () => {}), /did not produce live spoken content/);
  }
});
