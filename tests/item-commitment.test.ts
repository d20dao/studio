import { describe, expect, it } from 'vitest';
import { commitItems } from '../src/core/item-commitment';

describe('loot item commitment', () => {
  it('uses the leaf as the root of a single-item table', async () => {
    const commitment = await commitItems([{ tokenId: '42', uri: 'ipfs://one' }]);
    expect(commitment.depth).toBe(0);
    expect(commitment.registrations).toEqual([{ index: 0, tokenId: '42', uri: 'ipfs://one', proof: [] }]);
    expect(commitment.root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('pads to a power of two and binds each index, token ID and exact URI into the root', async () => {
    const items = [{ tokenId: '0', uri: 'ipfs://a' }, { tokenId: '1', uri: 'ipfs://b' }, { tokenId: '7', uri: 'ipfs://c' }];
    const commitment = await commitItems(items);
    expect(commitment.depth).toBe(2);
    expect(commitment.registrations.every(item => item.proof.length === 2)).toBe(true);
    expect(commitment.registrations[2].proof[0]).toBe(`0x${'0'.repeat(64)}`);
    const roots = await Promise.all([
      commitItems([items[0], items[1], { ...items[2], uri: 'ipfs://C' }]),
      commitItems([items[0], items[1], { ...items[2], tokenId: '8' }]),
      commitItems([items[1], items[0], items[2]]),
    ]);
    for (const other of roots) expect(other.root).not.toBe(commitment.root);
    expect((await commitItems(items)).root).toBe(commitment.root);
  });
});
