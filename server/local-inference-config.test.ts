import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NpcChat } from './npc.ts';
import { FantasyGmChat } from './fantasy-gm-chat.ts';
import { applyFantasyAction, newFantasyProfile } from '../shared/fantasy-engine.ts';
import { resolveLocalInferenceModel, resolveLocalInferenceUrl } from './local-inference-config.ts';

const bundledUrl = 'http://fantasy-ai:8080/v1';
const inferenceEnvKeys = ['NPC_LLM_URL', 'NPC_LLM_BUNDLED_URL', 'NPC_LLM_MODEL', 'NPC_LLM_BUNDLED_MODEL'] as const;
type InferenceEnv = Partial<Record<typeof inferenceEnvKeys[number], string>>;

test('inference URL defaults to the bundled service only when it is configured', () => {
  for (const env of [{}, { NPC_LLM_BUNDLED_URL: '' }, { NPC_LLM_BUNDLED_URL: ' ' }]) {
    assert.equal(resolveLocalInferenceUrl(env), 'http://127.0.0.1:18081/v1');
  }
  for (const env of [{ NPC_LLM_BUNDLED_URL: bundledUrl }, { NPC_LLM_URL: '', NPC_LLM_BUNDLED_URL: bundledUrl }, { NPC_LLM_URL: ' ', NPC_LLM_BUNDLED_URL: bundledUrl }]) {
    assert.equal(resolveLocalInferenceUrl(env), 'http://fantasy-ai:8080/v1');
  }
  for (const url of ['', ' ']) {
    for (const marker of [undefined, '', ' ']) assert.equal(resolveLocalInferenceUrl({ NPC_LLM_URL: url, NPC_LLM_BUNDLED_URL: marker }), url);
  }
});

test('bundled inference replaces only the historical HTTP loopback endpoint paths', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    for (const path of ['', '/', '/v1', '/v1/', '/v1/chat/completions', '/chat/completions']) {
      const url = `http://${host}:18081${path}`;
      assert.equal(resolveLocalInferenceUrl({ NPC_LLM_URL: url, NPC_LLM_BUNDLED_URL: bundledUrl }), 'http://fantasy-ai:8080/v1', url);
      assert.equal(resolveLocalInferenceUrl({ NPC_LLM_URL: url }), url);
      assert.equal(resolveLocalInferenceUrl({ NPC_LLM_URL: url, NPC_LLM_BUNDLED_URL: '' }), url);
    }
  }
});

test('bundled inference preserves custom and invalid configured URLs for endpoint validation', () => {
  for (const url of [
    'http://127.0.0.2:18081/v1', 'http://192.168.1.3:18081/v1', 'http://host.docker.internal:18081/v1',
    'http://custom-ai:8080/v1', 'http://localhost:18082/v1', 'https://localhost:18081/v1',
    'http://localhost:18081/custom', 'http://localhost:18081/v1/chat/completions/',
    'http://localhost:18081/v1?model=test', 'http://localhost:18081/v1#test',
    'http://user@localhost:18081/v1', 'http://localhost:18081/v1?next=https://example.com',
    'https://example.com/v1', 'http://8.8.8.8/v1', 'file:///tmp/model', 'invalid',
  ]) {
    assert.equal(resolveLocalInferenceUrl({ NPC_LLM_URL: url, NPC_LLM_BUNDLED_URL: bundledUrl }), url);
  }
});

test('inference models default to the larger model and preserve settings outside the bundled backend', () => {
  assert.equal(resolveLocalInferenceModel({}), 'qwen3-4b');
  for (const model of ['qwen3-1.7b', 'operator-model', '', ' ']) {
    for (const env of [
      { NPC_LLM_MODEL: model },
      { NPC_LLM_MODEL: model, NPC_LLM_BUNDLED_MODEL: 'qwen3-4b' },
      { NPC_LLM_MODEL: model, NPC_LLM_BUNDLED_URL: bundledUrl },
      { NPC_LLM_MODEL: model, NPC_LLM_BUNDLED_URL: bundledUrl, NPC_LLM_BUNDLED_MODEL: ' ' },
    ]) assert.equal(resolveLocalInferenceModel(env), model);
  }
});

test('bundled inference models replace stale defaults only for the selected bundled backend', () => {
  const bundled = { NPC_LLM_BUNDLED_URL: bundledUrl, NPC_LLM_BUNDLED_MODEL: 'qwen3-4b' };
  for (const model of [undefined, '', ' ', 'qwen3-1.7b']) {
    for (const url of [undefined, 'http://127.0.0.1:18081/v1', bundledUrl]) {
      assert.equal(resolveLocalInferenceModel({ ...bundled, NPC_LLM_MODEL: model, NPC_LLM_URL: url }), 'qwen3-4b');
    }
  }
  assert.equal(resolveLocalInferenceModel({ ...bundled, NPC_LLM_BUNDLED_MODEL: 'bundled-new-model', NPC_LLM_MODEL: 'qwen3-1.7b' }), 'bundled-new-model');
  assert.equal(resolveLocalInferenceModel({ ...bundled, NPC_LLM_MODEL: 'operator-model' }), 'operator-model');
  for (const url of ['http://192.168.1.3:9000/v1', 'http://custom-ai:8080/v1', 'http://localhost:18082/v1', 'http://localhost:18081/custom']) {
    assert.equal(resolveLocalInferenceModel({ ...bundled, NPC_LLM_URL: url, NPC_LLM_MODEL: 'qwen3-1.7b' }), 'qwen3-1.7b', url);
    assert.equal(resolveLocalInferenceModel({ ...bundled, NPC_LLM_MODEL: 'qwen3-1.7b' }, url), 'qwen3-1.7b', url);
  }
});

async function withEnvironment(env: InferenceEnv, action: () => Promise<void>) {
  const previous = inferenceEnvKeys.map(key => [key, process.env[key]] as const);
  try {
    for (const key of inferenceEnvKeys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    await action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function inferenceRequests(url?: string, error?: 'unavailable', model?: { expected: string; option?: string }) {
  const requests: string[] = [];
  const models: string[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init: RequestInit | undefined) => {
    requests.push(String(input));
    models.push(JSON.parse(String(init?.body)).model);
    return new Response(JSON.stringify({ model: 'local-test', choices: [{ message: { content: 'A quiet evening is pleasant.' } }] }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;
  const profile = applyFantasyAction(newFantasyProfile(), { type: 'create', name: 'Traveler', source: 'human', gender: 'female' }, () => .5).profile;
  const options = { url, model: model?.option, fetch };
  const request = { requestId: 'config-test', text: 'A quiet evening sounds pleasant.', locale: 'en' as const };
  const replies = [
    await new NpcChat(options).chat('config-test', { ...request, npcId: 'rin' }, { character: profile.character! }),
    await new FantasyGmChat(options).chat('config-test', request, { session: 'config-test', world: 'fantasy', profile }),
  ];
  for (const reply of replies) {
    assert.equal(reply.error, error);
    if (!error) assert.equal(reply.source, 'local');
  }
  if (model) assert.deepEqual(models, [model.expected, model.expected]);
  return requests;
}

test('NPC and GM request the larger default model without environment configuration', async () => {
  await withEnvironment({}, async () => {
    assert.deepEqual(await inferenceRequests(undefined, undefined, { expected: 'qwen3-4b' }), [
      'http://127.0.0.1:18081/v1/chat/completions',
      'http://127.0.0.1:18081/v1/chat/completions',
    ]);
  });
});

test('NPC and GM migrate a stale model name when the bundled backend is selected', async () => {
  await withEnvironment({ NPC_LLM_URL: 'http://127.0.0.1:18081/v1', NPC_LLM_BUNDLED_URL: bundledUrl, NPC_LLM_MODEL: 'qwen3-1.7b', NPC_LLM_BUNDLED_MODEL: 'qwen3-4b' }, async () => {
    assert.deepEqual(await inferenceRequests(undefined, undefined, { expected: 'qwen3-4b' }), [
      'http://fantasy-ai:8080/v1/chat/completions',
      'http://fantasy-ai:8080/v1/chat/completions',
    ]);
  });
});

test('NPC and GM preserve a configured model without a bundled model marker', async () => {
  await withEnvironment({ NPC_LLM_BUNDLED_URL: bundledUrl, NPC_LLM_MODEL: 'qwen3-1.7b' }, async () => {
    await inferenceRequests(undefined, undefined, { expected: 'qwen3-1.7b' });
  });
  await withEnvironment({ NPC_LLM_MODEL: 'qwen3-1.7b', NPC_LLM_BUNDLED_MODEL: 'qwen3-4b' }, async () => {
    await inferenceRequests(undefined, undefined, { expected: 'qwen3-1.7b' });
  });
});

test('NPC and GM keep operator model names and explicit constructor models', async () => {
  await withEnvironment({ NPC_LLM_BUNDLED_URL: bundledUrl, NPC_LLM_MODEL: 'operator-model', NPC_LLM_BUNDLED_MODEL: 'qwen3-4b' }, async () => {
    await inferenceRequests(undefined, undefined, { expected: 'operator-model' });
    await inferenceRequests(undefined, undefined, { expected: 'qwen3-1.7b', option: 'qwen3-1.7b' });
  });
});

test('NPC and GM preserve the legacy model for custom environment and constructor backends', async () => {
  const env = { NPC_LLM_BUNDLED_URL: bundledUrl, NPC_LLM_MODEL: 'qwen3-1.7b', NPC_LLM_BUNDLED_MODEL: 'qwen3-4b' };
  await withEnvironment({ ...env, NPC_LLM_URL: 'http://192.168.1.3:9000/custom' }, async () => {
    assert.deepEqual(await inferenceRequests(undefined, undefined, { expected: 'qwen3-1.7b' }), [
      'http://192.168.1.3:9000/custom/chat/completions',
      'http://192.168.1.3:9000/custom/chat/completions',
    ]);
  });
  await withEnvironment(env, async () => {
    assert.deepEqual(await inferenceRequests('http://custom-ai:9000/v1', undefined, { expected: 'qwen3-1.7b' }), [
      'http://custom-ai:9000/v1/chat/completions',
      'http://custom-ai:9000/v1/chat/completions',
    ]);
  });
});

test('NPC and GM migrate the historical loopback environment to the bundled service', async () => {
  await withEnvironment({ NPC_LLM_URL: 'http://127.0.0.1:18081/v1', NPC_LLM_BUNDLED_URL: bundledUrl }, async () => {
    assert.deepEqual(await inferenceRequests(), [
      'http://fantasy-ai:8080/v1/chat/completions',
      'http://fantasy-ai:8080/v1/chat/completions',
    ]);
  });
});

test('NPC and GM keep the developer loopback endpoint outside Compose', async () => {
  await withEnvironment({ NPC_LLM_URL: 'http://localhost:18081/v1' }, async () => {
    assert.deepEqual(await inferenceRequests(), [
      'http://localhost:18081/v1/chat/completions',
      'http://localhost:18081/v1/chat/completions',
    ]);
  });
});

test('NPC and GM use the bundled default for absent or empty configuration', async () => {
  for (const url of [undefined, '', ' ']) {
    await withEnvironment({ NPC_LLM_URL: url, NPC_LLM_BUNDLED_URL: bundledUrl }, async () => {
      assert.deepEqual(await inferenceRequests(), [
        'http://fantasy-ai:8080/v1/chat/completions',
        'http://fantasy-ai:8080/v1/chat/completions',
      ]);
    });
  }
});

test('NPC and GM reject explicitly empty configuration outside Compose', async () => {
  for (const url of ['', ' ']) {
    await withEnvironment({ NPC_LLM_URL: url }, async () => {
      assert.deepEqual(await inferenceRequests(undefined, 'unavailable'), []);
    });
  }
});

test('NPC and GM preserve custom endpoints and prioritize explicit constructor URLs', async () => {
  await withEnvironment({ NPC_LLM_URL: 'http://192.168.1.3:9000/custom', NPC_LLM_BUNDLED_URL: bundledUrl }, async () => {
    assert.deepEqual(await inferenceRequests(), [
      'http://192.168.1.3:9000/custom/chat/completions',
      'http://192.168.1.3:9000/custom/chat/completions',
    ]);
    assert.deepEqual(await inferenceRequests('http://localhost:18081/v1'), [
      'http://localhost:18081/v1/chat/completions',
      'http://localhost:18081/v1/chat/completions',
    ]);
  });
});

test('NPC and GM retain endpoint rejection when a bundled service is available', async () => {
  for (const url of ['http://8.8.8.8/v1', 'https://example.com/v1', 'http://user:secret@localhost:18081/v1', 'http://localhost:18081/v1?next=remote', 'file:///tmp/model', 'invalid']) {
    await withEnvironment({ NPC_LLM_URL: url, NPC_LLM_BUNDLED_URL: bundledUrl }, async () => {
      assert.deepEqual(await inferenceRequests(undefined, 'unavailable'), [], url);
    });
  }
});

test('NPC and GM reject invalid bundled targets without fetching the historical endpoint', async () => {
  for (const bundled of ['http://8.8.8.8/v1', 'https://example.com/v1', 'http://user:secret@fantasy-ai:8080/v1', 'file:///tmp/model', 'invalid']) {
    await withEnvironment({ NPC_LLM_URL: 'http://127.0.0.1:18081/v1', NPC_LLM_BUNDLED_URL: bundled }, async () => {
      assert.deepEqual(await inferenceRequests(undefined, 'unavailable'), [], bundled);
    });
  }
});
