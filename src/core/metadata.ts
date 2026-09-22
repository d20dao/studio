export const METADATA_BYTES = 256 * 1024;
export const IMAGE_BYTES = 5 * 1024 * 1024;
export const UINT256_MAX = (1n << 256n) - 1n;
export type Metadata = { name?: string; description?: string; image?: string; attributes: { trait: string; value: string }[] };

export function normalizeTokenId(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78 || BigInt(value) > UINT256_MAX) throw new Error('Token ID must be a decimal uint256 integer.');
  return BigInt(value).toString();
}
export function resolveMetadataUri(uri: string, tokenId = '0'): string {
  if (!uri || uri.length > 2048 || /[\u0000-\u0020\\]/.test(uri)) throw new Error('Enter an HTTPS, ipfs:// or ar:// URI.');
  let expanded = uri.replaceAll('{id}', BigInt(normalizeTokenId(tokenId)).toString(16).padStart(64, '0'));
  if (expanded.startsWith('ipfs://')) {
    const path = expanded.slice(7).replace(/^ipfs\//, '');
    if (!/^[a-zA-Z0-9]+(?:\/[^?#]*)?(?:[?#].*)?$/.test(path)) throw new Error('Invalid IPFS URI.');
    expanded = `https://ipfs.io/ipfs/${path}`;
  } else if (expanded.startsWith('ar://')) {
    const path = expanded.slice(5);
    if (!/^[a-zA-Z0-9_-]{43}(?:\/[^?#]*)?(?:[?#].*)?$/.test(path)) throw new Error('Invalid Arweave URI.');
    expanded = `https://arweave.net/${path}`;
  }
  const url = new URL(expanded);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new Error('Only public HTTPS metadata URLs are supported.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host.startsWith('[')) throw new Error('Use a public hostname for metadata.');
  url.hash = '';
  return url.href;
}
function optionalText(value: unknown, field: string, limit: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${field} must be text of at most ${limit} characters.`);
  return value;
}
export function parseMetadata(text: string, tokenId = '0'): Metadata {
  if (new TextEncoder().encode(text).length > METADATA_BYTES) throw new Error('Metadata exceeds 256 KB.');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Metadata is not valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Metadata must be a JSON object.');
  const source = data as Record<string, unknown>;
  const name = optionalText(source.name, 'name', 200);
  const description = optionalText(source.description, 'description', 4000);
  const rawImage = optionalText(source.image, 'image', 2048);
  const image = rawImage ? resolveMetadataUri(rawImage, tokenId) : undefined;
  if (source.attributes !== undefined && (!Array.isArray(source.attributes) || source.attributes.length > 64)) throw new Error('attributes must contain at most 64 traits.');
  const attributes = ((source.attributes ?? []) as unknown[]).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Trait ${index + 1} must be an object.`);
    const trait = entry as Record<string, unknown>;
    const title = optionalText(trait.trait_type, 'trait_type', 100) ?? 'Property';
    if (!['string', 'number', 'boolean'].includes(typeof trait.value) || typeof trait.value === 'number' && !Number.isFinite(trait.value)) throw new Error(`Trait ${index + 1} has an invalid value.`);
    const value = String(trait.value);
    if (value.length > 300) throw new Error(`Trait ${index + 1} value exceeds 300 characters.`);
    return { trait: title, value };
  });
  return { name, description, image, attributes };
}

let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (active >= 3) await new Promise<void>((resolve, reject) => {
    const resume = () => { active++; signal.removeEventListener('abort', cancel); resolve(); };
    const cancel = () => { const i = waiting.indexOf(resume); if (i >= 0) waiting.splice(i, 1); reject(new DOMException('Aborted', 'AbortError')); };
    waiting.push(resume); signal.addEventListener('abort', cancel, { once: true });
  }); else active++;
  if (signal.aborted) { active--; waiting.shift()?.(); throw new DOMException('Aborted', 'AbortError'); }
  try { return await task(); } finally { active--; waiting.shift()?.(); }
}
async function fetchBounded(url: string, bytes: number, signal: AbortSignal, image = false): Promise<Blob> {
  return limited(signal, async () => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', mode: 'cors' });
      if (!response.ok) throw new Error(`Metadata server returned HTTP ${response.status}.`);
      if (Number(response.headers.get('content-length')) > bytes) throw new Error(`Response exceeds ${image ? '5 MB' : '256 KB'}.`);
      const type = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
      if (image && !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(type)) throw new Error('Preview supports PNG, JPEG, WebP, GIF and AVIF images.');
      if (!response.body) throw new Error('Empty response.');
      const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
      try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > bytes) { await reader.cancel(); throw new Error(`Response exceeds ${image ? '5 MB' : '256 KB'}.`); } chunks.push(new Uint8Array(value)); } }
      finally { reader.releaseLock(); }
      return new Blob(chunks, { type });
    } catch (error) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (controller.signal.aborted) throw new Error('Preview request timed out after 10 seconds.');
      if (error instanceof TypeError) throw new Error('Could not fetch preview. The host may block CORS, redirect requests, or be unavailable. Load local JSON instead.');
      throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  });
}
const cache = new Map<string, { time: number; data: Metadata }>();
export async function fetchMetadata(uri: string, tokenId: string, signal: AbortSignal, refresh = false): Promise<Metadata> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const url = resolveMetadataUri(uri, tokenId); const key = `${url}|${tokenId}`;
  const cached = cache.get(key);
  if (!refresh && cached && Date.now() - cached.time < 300_000) return cached.data;
  const data = parseMetadata(await (await fetchBounded(url, METADATA_BYTES, signal)).text(), tokenId);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, { time: Date.now(), data }); return data;
}
export async function fetchMetadataImage(url: string, signal: AbortSignal): Promise<Blob> {
  return fetchBounded(resolveMetadataUri(url), IMAGE_BYTES, signal, true);
}
