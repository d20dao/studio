import { describe, expect, it, vi } from 'vitest';
import { fetchMetadata, fetchMetadataImage, METADATA_BYTES, normalizeTokenId, parseMetadata, resolveMetadataUri } from '../src/core/metadata';

describe('metadata URI and parser', () => {
  it('resolves ERC1155 IDs and fixed decentralized gateways', () => {
    expect(resolveMetadataUri('ipfs://bafyabc/{id}.json', '15')).toBe(`https://ipfs.io/ipfs/bafyabc/${'f'.padStart(64, '0')}.json`);
    expect(resolveMetadataUri(`ar://${'a'.repeat(43)}/image.png`)).toBe(`https://arweave.net/${'a'.repeat(43)}/image.png`);
    expect(resolveMetadataUri('https://example.com/{id}', '0')).toContain('0'.repeat(64));
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', 'http://example.com/a', 'https://user:pass@example.com/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://host.local/a', 'https://[::1]/a', 'https://example.com:444/a'])('rejects unsupported or private URI %s', uri => {
    expect(() => resolveMetadataUri(uri)).toThrow();
  });
  it('validates canonical token IDs without precision loss', () => {
    const max = ((1n << 256n) - 1n).toString(); expect(normalizeTokenId(max)).toBe(max);
    for (const bad of ['01', '-1', '1.5', (1n << 256n).toString()]) expect(() => normalizeTokenId(bad)).toThrow();
  });
  it('keeps descriptions as text and ignores scripts and HTML media', () => {
    expect(parseMetadata(JSON.stringify({ name: '<script>x</script>', description: '<b>Untrusted</b>', animation_url: 'javascript:alert(1)', image_data: '<svg/>', attributes: [{ trait_type: 'Level', value: 3 }, { value: true }] }))).toEqual({ name: '<script>x</script>', description: '<b>Untrusted</b>', image: undefined, attributes: [{ trait: 'Level', value: '3' }, { trait: 'Property', value: 'true' }] });
  });
  it('rejects oversized and malformed fields rather than truncating', () => {
    for (const text of ['[]', '{', JSON.stringify({ name: 'x'.repeat(201) }), JSON.stringify({ description: 'x'.repeat(4001) }), JSON.stringify({ attributes: [{ value: {} }] }), JSON.stringify({ attributes: Array(65).fill({ value: 1 }) }), ' '.repeat(METADATA_BYTES + 1)]) expect(() => parseMetadata(text)).toThrow();
  });
});

describe('bounded metadata retrieval', () => {
  it('returns CORS failure as an actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchMetadata('https://example.com/cors.json', '0', new AbortController().signal, true)).rejects.toThrow('CORS'); vi.unstubAllGlobals();
  });
  it('rejects oversized streamed content without content-length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(' '.repeat(METADATA_BYTES + 1))));
    await expect(fetchMetadata('https://example.com/large.json', '0', new AbortController().signal, true)).rejects.toThrow('256 KB'); vi.unstubAllGlobals();
  });
  it('caches successful metadata but refresh fetches again', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{"name":"Relic"}'))); vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await fetchMetadata('https://example.com/cache.json', '0', signal, true); await fetchMetadata('https://example.com/cache.json', '0', signal); expect(fetch).toHaveBeenCalledTimes(1);
    await fetchMetadata('https://example.com/cache.json', '0', signal, true); expect(fetch).toHaveBeenCalledTimes(2); vi.unstubAllGlobals();
  });
  it('rejects executable or unsupported image content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })));
    await expect(fetchMetadataImage('https://example.com/art.svg', new AbortController().signal)).rejects.toThrow('PNG'); vi.unstubAllGlobals();
  });
  it('honors cancellation before requesting', async () => {
    const controller = new AbortController(); controller.abort(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchMetadata('https://example.com/abort.json', '0', controller.signal, true)).rejects.toHaveProperty('name', 'AbortError'); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it('limits concurrent network requests to three', async () => {
    let live = 0; let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { live++; peak = Math.max(peak, live); await new Promise(resolve => setTimeout(resolve, 2)); live--; return new Response('{"name":"Queued"}'); }));
    await Promise.all(Array.from({ length: 9 }, (_, i) => fetchMetadata(`https://example.com/queue-${i}.json`, '0', new AbortController().signal, true)));
    expect(peak).toBe(3); vi.unstubAllGlobals();
  });
  it('reports the request deadline as a timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => { options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); })));
    const outcome = expect(fetchMetadata('https://example.com/timeout.json', '0', new AbortController().signal, true)).rejects.toThrow('10 seconds');
    await vi.advanceTimersByTimeAsync(10_000); await outcome;
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
});
