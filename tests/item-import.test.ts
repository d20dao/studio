import { describe, expect, it } from 'vitest';
import { itemSetErrors, parseItemsImport } from '../src/core/item-import';
const item = { name: 'Relic', metadataUri: 'ipfs://bafyabc/{id}.json', weight: 5 };
describe('bounded loot item import', () => {
  it('parses quoted CSV values and embedded lines preserving data', () => {
    const result = parseItemsImport('name,metadataUri,weight,tokenId\r\n"Relic, ancient",https://example.com/a.json,5,9007199254740993\r\n"Multi\nline",,2,9', 'csv');
    expect(result.errors).toEqual([]); expect(result.items[0].name).toBe('Relic, ancient'); expect(result.items[0].tokenId).toBe('9007199254740993'); expect(result.items[1].name).toBe('Multi\nline');
  });
  it('assigns fresh stable row identities and accepts an items wrapper', () => {
    const result = parseItemsImport(JSON.stringify({ items: [{ ...item, id: 'untrusted' }] }), 'json'); expect(result.errors).toEqual([]); expect(result.items[0].id).not.toBe('untrusted'); expect(result.items[0].id).toMatch(/^[a-f0-9-]+$/);
  });
  it.each([-1, 1.5, '2x', Number.MAX_SAFE_INTEGER + 1])('rejects invalid weight %s', weight => { expect(parseItemsImport(JSON.stringify([{ ...item, weight }]), 'json').errors.length).toBeGreaterThan(0); });
  it('rejects truncation, over-limit rows, bad schema and zero totals', () => {
    for (const source of [[{ ...item, name: 'x'.repeat(81) }], [{ ...item, metadataUri: 'x'.repeat(513) }], Array(257).fill(item), [{ ...item, tokenId: 2 }], [{ ...item, weight: 0 }]]) expect(parseItemsImport(JSON.stringify(source), 'json').errors.length).toBeGreaterThan(0);
    expect(parseItemsImport('name,metadataUri,weight\n"unclosed,,5', 'csv').errors.length).toBeGreaterThan(0);
    expect(parseItemsImport('name,metadataUri,weight\nx,,5,extra', 'csv').errors.length).toBeGreaterThan(0);
  });
  it('detects explicit IDs colliding with implicit row IDs', () => {
    const result = parseItemsImport(JSON.stringify([{ ...item, tokenId: '1' }, item]), 'json'); expect(result.errors.join(' ')).toContain('unique');
  });
  it('checks combined append IDs at their final indexes', () => {
    const first = parseItemsImport(JSON.stringify([{ ...item, tokenId: '1' }]), 'json'); const next = parseItemsImport(JSON.stringify([item]), 'json'); expect(itemSetErrors([...first.items, ...next.items]).join(' ')).toContain('unique');
  });
  it('matches project weight, URI-prefix and control-character validation', () => {
    for (const override of [{ weight: 1_000_001 }, { metadataUri: 'http://example.com/item.json' }, { metadataUri: 'javascript:alert(1)' }, { name: 'Bad\u0000name' }, { metadataUri: 'ipfs://bad\u0007' }]) {
      expect(parseItemsImport(JSON.stringify([{ ...item, ...override }]), 'json').errors.length).toBeGreaterThan(0);
    }
    expect(parseItemsImport(JSON.stringify([{ ...item, weight: 1_000_000, metadataUri: '' }]), 'json').errors).toEqual([]);
  });
});
