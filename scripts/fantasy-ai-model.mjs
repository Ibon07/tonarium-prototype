import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FANTASY_AI_MODEL = Object.freeze({
  filename: 'Qwen3-4B-Q4_K_M.gguf',
  url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf',
  bytes: 2497280256,
  sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
});

async function hasVerifiedModel(path, manifest, signal) {
  let existing;
  try {
    existing = await stat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!existing.isFile()) throw new Error(`Model path is not a file: ${path}`);
  if (existing.size !== manifest.bytes) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex') === manifest.sha256;
}

export async function prepareModel({ directory = '/models', manifest = FANTASY_AI_MODEL, fetch: fetchModel = globalThis.fetch, signal, statfs: checkDisk = statfs } = {}) {
  signal?.throwIfAborted();
  await mkdir(directory, { recursive: true });
  const path = join(directory, manifest.filename);
  if (await hasVerifiedModel(path, manifest, signal)) return { path, reused: true };
  const disk = await checkDisk(directory, { bigint: true });
  const requiredBytes = BigInt(manifest.bytes) + 128n * 1024n * 1024n;
  if (BigInt(disk.bavail) * BigInt(disk.bsize) < requiredBytes) {
    throw new Error(`Insufficient free disk space: at least ${requiredBytes} bytes are required`);
  }
  const temporaryPath = join(directory, `.${manifest.filename}.${randomUUID()}.part`);
  let file;
  try {
    const response = await fetchModel(manifest.url, { signal });
    if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
    if (!response.body) throw new Error('Model download has no response body');
    file = await open(temporaryPath, 'wx', 0o644);
    let count = 0;
    const hash = createHash('sha256');
    for await (const chunk of response.body) {
      signal?.throwIfAborted();
      count += chunk.byteLength;
      if (count > manifest.bytes) throw new Error('Model download exceeds expected size');
      hash.update(chunk);
      await file.writeFile(chunk);
    }
    if (count !== manifest.bytes) throw new Error('Model download size does not match expected size');
    if (hash.digest('hex') !== manifest.sha256) throw new Error('Model SHA-256 does not match');
    await file.sync();
    await file.close();
    file = undefined;
    signal?.throwIfAborted();
    await rename(temporaryPath, path);
    return { path, reused: false };
  } finally {
    await file?.close();
    await rm(temporaryPath, { force: true });
  }
}

export function parseAvailableMemoryMb(meminfo) {
  const match = /^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(meminfo);
  const availableKb = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(availableKb)) throw new Error('Cannot read MemAvailable from /proc/meminfo');
  return Math.floor(availableKb / 1024);
}

export function parseMinimumAvailableMb(value) {
  if (value === undefined) return 4608;
  const minimum = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(minimum) || minimum < 256 || minimum > 65536) {
    throw new Error('NPC_AI_MIN_AVAILABLE_MB must be an integer from 256 to 65536');
  }
  return minimum;
}

export async function runModelPreparation({
  env = process.env,
  platform = process.platform,
  readMeminfo = (signal) => readFile('/proc/meminfo', { encoding: 'utf8', signal }),
  prepare = prepareModel,
  signal,
} = {}) {
  const limitedSignal = AbortSignal.any([AbortSignal.timeout(20 * 60 * 1000), ...(signal ? [signal] : [])]);
  limitedSignal.throwIfAborted();
  const minimumMb = parseMinimumAvailableMb(env.NPC_AI_MIN_AVAILABLE_MB);
  if (platform === 'linux') {
    const availableMb = parseAvailableMemoryMb(await readMeminfo(limitedSignal));
    if (availableMb < minimumMb) {
      throw new Error(`Insufficient host available memory: ${availableMb} MiB available; at least ${minimumMb} MiB required. Adjust NPC_AI_MIN_AVAILABLE_MB only after checking the server memory budget.`);
    }
  }
  return prepare({ directory: env.MODEL_DIRECTORY ?? '/models', manifest: FANTASY_AI_MODEL, signal: limitedSignal });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Model preparation interrupted'));
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  try {
    const result = await runModelPreparation({ signal: controller.signal });
    console.log(`Fantasy AI model ${result.reused ? 'verified' : 'downloaded and verified'}: ${result.path}`);
  } catch (error) {
    console.error(`Fantasy AI model preparation failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    process.off('SIGTERM', interrupt);
    process.off('SIGINT', interrupt);
  }
}
