import type { LootItem } from './types';
import { normalizeTokenId } from './metadata';
import { createProject, validateProject } from './project';
export type ItemImport = { items: LootItem[]; errors: string[] };
const LIMIT = 256;
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false; let endedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; endedQuote = true; } } else value += char; }
    else if (char === '"' && !value && !endedQuote) quoted = true;
    else if (char === ',' || char === '\n' || char === '\r') {
      row.push(value); value = ''; endedQuote = false;
      if (char !== ',') { if (char === '\r' && text[i + 1] === '\n') i++; if (row.some(cell => cell !== '')) rows.push(row); row = []; }
    } else { if (endedQuote || char === '"') throw new Error('Invalid CSV quoting.'); value += char; }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted value.');
  row.push(value); if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}
export function effectiveTokenIds(items: LootItem[]): string[] { return items.map((item, i) => normalizeTokenId(item.tokenId ?? String(i))); }
export function itemSetErrors(items: LootItem[]): string[] {
  const errors: string[] = [];
  if (items.length > LIMIT) errors.push(`A loot table supports at most ${LIMIT} items.`);
  try { const ids = effectiveTokenIds(items); if (new Set(ids).size !== ids.length) errors.push('Effective token IDs must be unique. Set explicit token IDs to resolve conflicts.'); }
  catch (error) { errors.push(error instanceof Error ? error.message : 'Invalid token ID.'); }
  return errors;
}
export function parseItemsImport(text: string, format: 'json' | 'csv'): ItemImport {
  const errors: string[] = [];
  try {
    if (new TextEncoder().encode(text).length > 512 * 1024) throw new Error('Item imports must be 512 KB or smaller.');
    let source: unknown;
    if (format === 'json') { const parsed = JSON.parse(text); source = Array.isArray(parsed) ? parsed : parsed?.items; }
    else {
      const rows = csvRows(text.replace(/^\uFEFF/, '')); const headers = rows.shift()?.map(header => header.trim());
      if (!headers || !['name', 'metadataUri', 'weight'].every(header => headers.includes(header))) throw new Error('CSV headers must include name,metadataUri,weight. tokenId is optional.');
      if (new Set(headers).size !== headers.length || headers.some(header => !['name', 'metadataUri', 'weight', 'tokenId'].includes(header))) throw new Error('CSV has duplicate or unsupported headers.');
      source = rows.map((row, i) => { if (row.length !== headers.length) throw new Error(`CSV row ${i + 2} has ${row.length} columns; expected ${headers.length}.`); return Object.fromEntries(headers.map((key, j) => [key, row[j]])); });
    }
    if (!Array.isArray(source) || source.length === 0 || source.length > LIMIT) throw new Error('Import an array of 1–256 items.');
    const items = source.map((entry: unknown, index): LootItem | null => {
      try {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('must be an object.');
        const row = entry as Record<string, unknown>;
        if (Object.keys(row).some(key => !['name', 'metadataUri', 'weight', 'tokenId', 'id'].includes(key))) throw new Error('contains unsupported fields.');
        if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80) throw new Error('name must contain 1–80 characters.');
        if (typeof row.metadataUri !== 'string' || row.metadataUri.length > 512) throw new Error('metadataUri must be text of at most 512 characters.');
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(row.name + row.metadataUri)) throw new Error('name and metadataUri must not contain unsupported control characters.');
        if (row.metadataUri && !/^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(row.metadataUri)) throw new Error('metadataUri must use an HTTPS, IPFS or Arweave prefix.');
        const weight = typeof row.weight === 'number' ? row.weight : typeof row.weight === 'string' && /^\d+$/.test(row.weight) ? Number(row.weight) : NaN;
        if (!Number.isSafeInteger(weight) || weight < 0 || weight > 1_000_000) throw new Error('weight must be a whole number between 0 and 1,000,000.');
        const tokenId = row.tokenId === '' || row.tokenId === undefined ? undefined : typeof row.tokenId === 'string' ? normalizeTokenId(row.tokenId) : (() => { throw new Error('tokenId must be a decimal string to preserve precision.'); })();
        return { id: crypto.randomUUID(), name: row.name, metadataUri: row.metadataUri, weight, ...(tokenId === undefined ? {} : { tokenId }) };
      } catch (error) { errors.push(`Item ${index + 1}: ${error instanceof Error ? error.message : 'invalid data'}`); return null; }
    }).filter((item): item is LootItem => item !== null);
    if (!errors.length) {
      // Import accepts incomplete metadata for editing and existing integrations.
      // The destination project enforces metadata requirements before generation.
      const draft = createProject('Item import validation', 'lootbox', 'existing'); draft.loot.items = items;
      errors.push(...validateProject(draft).filter(issue => issue.severity === 'error').map(issue => issue.message));
    }
    return { items, errors };
  } catch (error) { return { items: [], errors: [error instanceof Error ? error.message : 'Could not read item import.'] }; }
}
