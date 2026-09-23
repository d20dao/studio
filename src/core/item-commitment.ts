/** Proof that one configured loot item belongs to the collection's generated ITEMS_ROOT. */
export interface ItemRegistration { index: number; tokenId: string; uri: string; proof: string[] }
export interface ItemCommitment { root: string; depth: number; registrations: ItemRegistration[] }

// Domain bytes separate leaves from interior nodes; the Solidity verifier uses the same encoding.
const LEAF = 0x00;
const NODE = 0x01;

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function uint256(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(value & 0xffn); value >>= 8n; }
  return out;
}

const hex = (bytes: Uint8Array) => `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;

/**
 * SHA-256 Merkle tree over sha256(0x00 ‖ index ‖ tokenId ‖ sha256(uri)) leaves in configured order,
 * padded with zero leaves to a power of two. Nodes are sha256(0x01 ‖ left ‖ right).
 */
export async function commitItems(items: { tokenId: string; uri: string }[]): Promise<ItemCommitment> {
  let depth = 0;
  while (2 ** depth < items.length) depth++;
  const leaves = await Promise.all(items.map(async (item, index) => sha256(concat([
    Uint8Array.of(LEAF), uint256(BigInt(index)), uint256(BigInt(item.tokenId)), await sha256(new TextEncoder().encode(item.uri)),
  ]))));
  const levels: Uint8Array[][] = [[...leaves, ...Array.from({ length: 2 ** depth - leaves.length }, () => new Uint8Array(32))]];
  while (levels[levels.length - 1].length > 1) {
    const level = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(await sha256(concat([Uint8Array.of(NODE), level[i], level[i + 1]])));
    levels.push(next);
  }
  return {
    root: hex(levels[depth][0]),
    depth,
    registrations: items.map((item, index) => ({
      index, tokenId: item.tokenId, uri: item.uri,
      proof: levels.slice(0, depth).map((level, height) => hex(level[(index >> height) ^ 1])),
    })),
  };
}
