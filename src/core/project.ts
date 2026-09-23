import type { IntegrationTarget, Mechanic, StudioProject, ValidationIssue } from './types';

export const PROJECT_SCHEMA_VERSION = 4;
export const MAX_PROJECT_BYTES = 512 * 1024;
export const MAX_ITEMS = 256;
export const MAX_URI_LENGTH = 512;
export const MAX_ADDRESS_LENGTH = 80;
export const MAX_PROJECT_NAME_LENGTH = 80;
const MAX_UINT256 = (1n << 256n) - 1n;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const zeroAddress = /^0x0{40}$/i;
/** Lowercase schemes only: onchain URIs are returned verbatim to wallets and marketplaces. */
export const METADATA_REFERENCE = /^(https:\/\/|ipfs:\/\/|ar:\/\/)/;

export function createProject(name: string, mechanic: Mechanic, integration: IntegrationTarget = 'new'): StudioProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, id: crypto.randomUUID(), name, mechanic, integration,
    network: 'arc-testnet', createdAt: now, updatedAt: now, isExample: false,
    collection: { name, symbol: mechanic === 'reveal' ? 'RELIC' : 'ITEM', standard: mechanic === 'reveal' ? 'erc721' : 'erc1155', maxSupply: null, metadataBaseUri: '' },
    loot: { items: [
      { id: 'iron-shard', name: 'Iron shard', metadataUri: '', weight: 70 },
      { id: 'moonstone', name: 'Moonstone', metadataUri: '', weight: 25 },
      { id: 'ancient-relic', name: 'Ancient relic', metadataUri: '', weight: 5 },
    ] },
    reveal: { mode: 'shuffle', unrevealedUri: '' },
    modules: {
      premint: { enabled: false, quantity: 8, recipient: '', includeInReveal: true },
      royalty: { enabled: false, bps: 500, recipient: '' },
    },
    payment: { price: '0', rngPayer: 'user', refundRecipient: 'payer', refundAddress: '', recovery: 'both', applicationRefund: 'refund-on-expiry' },
  };
}

export function createExampleProjects(): StudioProject[] {
  return [createProject('Relic Crate', 'lootbox'), createProject('Relic Collection', 'reveal')].map(project => ({ ...project, isExample: true }));
}

export function projectSlug(project: Pick<StudioProject, 'name'>): string {
  return project.name.normalize('NFKD').replace(/[^a-zA-Z0-9 -]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '-').slice(0,64) || 'studio-project';
}

export function validateProject(project: StudioProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  const warning = (path: string, message: string) => issues.push({ path, message, severity: 'warning' });
  const whole = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
  if (!project.name.trim() || project.name.length > 80) error('name', 'Enter a project name of 1–80 characters.');
  if (!project.collection.name.trim() || project.collection.name.length > 80) error('collection.name', 'Enter a collection name of 1–80 characters.');
  if (!/^[a-zA-Z0-9_-]{1,16}$/.test(project.collection.symbol)) error('collection.symbol', 'Use 1–16 letters, numbers, underscores, or hyphens.');
  const supplyCap = project.collection.maxSupply;
  if (supplyCap !== null && !whole(supplyCap, 1, Number.MAX_SAFE_INTEGER)) error('collection.maxSupply', 'Use a positive safe whole number for the supply cap, or choose unlimited supply.');
  if (!['shuffle', 'offset', 'token-hash'].includes(project.reveal?.mode)) error('reveal.mode', 'Choose shuffle, index offset, or per-token hash.');
  if (project.mechanic === 'reveal') {
    if (project.collection.standard !== 'erc721') error('collection.standard', 'The reveal starter currently describes an ERC-721 collection.');
    if (!project.collection.metadataBaseUri.trim()) {
      if (project.integration === 'new') error('collection.metadataBaseUri', 'Set the final metadata base URI before generating the collection; it has no URI setter.');
      else warning('collection.metadataBaseUri', 'Add the final metadata reference before integrating the reveal.');
    }
  } else {
    if (project.collection.standard !== 'erc1155') error('collection.standard', 'The loot starter currently describes ERC-1155 rewards.');
    if (project.loot.items.length < 1 || project.loot.items.length > MAX_ITEMS) error('loot.items', 'Configure between 1 and 256 items.');
    const ids = new Set<string>();
    const tokenIds = new Set<string>();
    let total = 0;
    project.loot.items.forEach((item, i) => {
      const prefix = `loot.items.${i}`;
      if (!item.id || ids.has(item.id)) error(`${prefix}.id`, 'Each item must have a unique, stable identifier.');
      ids.add(item.id);
      const tokenId = item.tokenId ?? String(i);
      if (!isTokenId(tokenId)) error(`${prefix}.tokenId`, 'Use an unsigned decimal token ID within uint256.');
      else if (tokenIds.has(tokenId)) error(`${prefix}.tokenId`, 'Each effective token ID must be unique, including row-index defaults.');
      tokenIds.add(tokenId);
      if (!item.name.trim() || item.name.length > 80) error(`${prefix}.name`, 'Enter an item name of 1–80 characters.');
      if (!whole(item.weight, 0, 1_000_000)) error(`${prefix}.weight`, 'Weight must be a whole number between 0 and 1,000,000.');
      total += item.weight;
      if (project.integration === 'new' && !item.metadataUri.trim()) error(`${prefix}.metadataUri`, 'Set the final item metadata URI before generating the collection; it has no URI setter.');
      if (item.metadataUri && !METADATA_REFERENCE.test(item.metadataUri)) error(`${prefix}.metadataUri`, 'Use a lowercase https://, ipfs:// or ar:// metadata reference.');
    });
    if (!Number.isSafeInteger(total) || total <= 0) error('loot.items', 'At least one item needs a positive weight.');
  }
  if (project.collection.metadataBaseUri && !METADATA_REFERENCE.test(project.collection.metadataBaseUri)) error('collection.metadataBaseUri', 'Use a lowercase https://, ipfs:// or ar:// metadata reference.');
  const unrevealedUri = project.reveal?.unrevealedUri ?? '';
  if (unrevealedUri && !METADATA_REFERENCE.test(unrevealedUri)) error('reveal.unrevealedUri', 'Use a lowercase https://, ipfs:// or ar:// metadata reference.');
  if (project.mechanic === 'reveal' && project.integration === 'new' && !unrevealedUri.trim()) warning('reveal.unrevealedUri', 'Unrevealed tokens will return an empty tokenURI, so marketplaces show no metadata until reveal. Add a placeholder metadata URI.');
  const premint = project.modules.premint;
  if (premint.enabled) {
    if (!whole(premint.quantity, 1, supplyCap ?? Number.MAX_SAFE_INTEGER)) error('modules.premint.quantity', supplyCap === null ? 'Premint quantity must be a positive safe whole number.' : 'Premint must be a positive safe whole number within the supply cap.');
    if (!addressPattern.test(premint.recipient) || zeroAddress.test(premint.recipient)) error('modules.premint.recipient', 'Enter a complete, nonzero recipient address.');
    if (project.integration === 'new' && project.mechanic === 'reveal' && supplyCap !== null && !premint.includeInReveal && premint.quantity === supplyCap) warning('modules.premint.includeInReveal', 'All tokens under this supply cap are excluded premints; no tokens are eligible for reveal.');
  }
  const royalty = project.modules.royalty;
  if (royalty.enabled) {
    if (!whole(royalty.bps, 0, 10000)) error('modules.royalty.bps', 'Royalty must be between 0 and 10,000 basis points.');
    if (!addressPattern.test(royalty.recipient) || zeroAddress.test(royalty.recipient)) error('modules.royalty.recipient', 'Enter a complete, nonzero royalty receiver address.');
  }
  const payment = project.payment;
  if (!/^(0|[1-9][0-9]{0,40})(\.[0-9]{1,18})?$/.test(payment.price)) error('payment.price', 'Enter a non-negative price with at most 18 decimal places.');
  else if (/[1-9]/.test(payment.price)) warning('payment.price', project.integration === 'existing'
    ? 'The generated adapter does not collect this price. Implement the sale in your host integration.'
    : project.mechanic === 'lootbox'
      ? 'The generated contracts do not collect this price: anyone can call open() and pay only the RNG fee until your integration enforces the sale in _authorizeOpen.'
      : 'The generated contracts do not collect this price: only the collection owner mints. Implement the sale in your integration.');
  if (payment.rngPayer === 'developer') warning('payment.rngPayer', 'The generated consumer charges the RNG fee to its caller. Developer sponsorship is integration work.');
  if (payment.refundRecipient !== 'payer') {
    if (!addressPattern.test(payment.refundAddress) || zeroAddress.test(payment.refundAddress)) error('payment.refundAddress', 'Enter a complete, nonzero refund address.');
    warning('payment.refundRecipient', 'The generated consumer fixes protocol refunds to its caller. Routing them to this address is integration work.');
  }
  if (project.network === 'arc-mainnet') warning('network', 'Mainnet is a project target only. Recheck the live manifest and pricing before integration.');
  // Business-incomplete drafts remain valid data, but no UI state may be called
  // valid when the same JSON would be rejected on the next load/import.
  try { parseProjectJson(JSON.stringify(project)); }
  catch (cause) { error('project', cause instanceof Error ? cause.message : 'The project exceeds the supported data limits.'); }
  return issues;
}

export function isTokenId(value: string): boolean {
  return /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) <= MAX_UINT256;
}

type RecordValue = Record<string, unknown>;
function object(value: unknown, path: string, keys: readonly string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid project: ${path} must be an object.`);
  const record = value as RecordValue;
  if (Object.keys(record).some(key => !keys.includes(key))) throw new Error(`Invalid project: unsupported field in ${path}.`);
  return record;
}
function text(value: unknown, path: string, max = MAX_URI_LENGTH): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) throw new Error(`Invalid project: ${path} must be bounded text.`);
  return value;
}
function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid project: ${path} must be a finite number.`);
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid project: ${path} must be a boolean.`);
  return value;
}
function oneOf<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(`Invalid project: unsupported ${path}.`);
  return value as T;
}

/** Decode and migrate data in memory; the original file/storage snapshot is never written here. */
export function parseProjectJson(input: string): StudioProject {
  if (new TextEncoder().encode(input).byteLength > MAX_PROJECT_BYTES) throw new Error('Project files must be smaller than 512 KB.');
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error('The project file is not valid JSON.'); }
  const p = object(value, 'project', ['schemaVersion','id','name','mechanic','integration','network','createdAt','updatedAt','isExample','collection','loot','reveal','modules','payment']);
  if (p.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error(`Unsupported project schema. This Studio reads version ${PROJECT_SCHEMA_VERSION} projects.`);
  const reveal = object(p.reveal, 'reveal', ['mode','unrevealedUri']);
  const c = object(p.collection, 'collection', ['name','symbol','standard','maxSupply','metadataBaseUri']);
  const l = object(p.loot, 'loot', ['items']);
  const m = object(p.modules, 'modules', ['premint','royalty']);
  const premint = object(m.premint, 'premint', ['enabled','quantity','recipient','includeInReveal']);
  const royalty = object(m.royalty, 'royalty', ['enabled','bps','recipient']);
  const payment = object(p.payment, 'payment', ['price','rngPayer','refundRecipient','refundAddress','recovery','applicationRefund']);
  if (!Array.isArray(l.items) || l.items.length > MAX_ITEMS) throw new Error('Invalid project: items must be an array of at most 256 entries.');
  const id = text(p.id, 'id', 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new Error('Invalid project identifier.');
  const createdAt = text(p.createdAt, 'createdAt', 40), updatedAt = text(p.updatedAt, 'updatedAt', 40);
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw new Error('Invalid project timestamps.');
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, id, name: text(p.name, 'name', 80),
    mechanic: oneOf(p.mechanic, ['lootbox','reveal'], 'mechanic'),
    integration: oneOf(p.integration, ['new','existing'], 'integration'),
    network: oneOf(p.network, ['arc-testnet','arc-mainnet'], 'network'),
    createdAt, updatedAt, isExample: boolean(p.isExample, 'isExample'),
    collection: { name: text(c.name, 'collection.name', 80), symbol: text(c.symbol, 'symbol', 16), standard: oneOf(c.standard, ['erc721','erc1155'], 'standard'), maxSupply: c.maxSupply === null ? null : number(c.maxSupply, 'maxSupply'), metadataBaseUri: text(c.metadataBaseUri, 'metadataBaseUri') },
    reveal: { mode: oneOf(reveal.mode, ['shuffle', 'offset', 'token-hash'], 'reveal.mode'), unrevealedUri: text(reveal.unrevealedUri, 'reveal.unrevealedUri') },
    loot: { items: l.items.map((item, index) => {
      const i = object(item, `item ${index}`, ['id','tokenId','name','metadataUri','weight']);
      const tokenId = i.tokenId === undefined ? undefined : text(i.tokenId, 'item.tokenId', 78);
      if (tokenId !== undefined && !isTokenId(tokenId)) throw new Error('Invalid project: tokenId must be an unsigned decimal uint256.');
      return { id: text(i.id, 'item.id', 80), ...(tokenId === undefined ? {} : { tokenId }), name: text(i.name, 'item.name', 80), metadataUri: text(i.metadataUri, 'item.metadataUri'), weight: number(i.weight, 'item.weight') };
    }) },
    modules: {
      premint: { enabled: boolean(premint.enabled, 'premint.enabled'), quantity: number(premint.quantity, 'premint.quantity'), recipient: text(premint.recipient, 'premint.recipient', MAX_ADDRESS_LENGTH), includeInReveal: boolean(premint.includeInReveal, 'premint.includeInReveal') },
      royalty: { enabled: boolean(royalty.enabled, 'royalty.enabled'), bps: number(royalty.bps, 'royalty.bps'), recipient: text(royalty.recipient, 'royalty.recipient', MAX_ADDRESS_LENGTH) },
    },
    payment: { price: text(payment.price, 'price', 64), rngPayer: oneOf(payment.rngPayer, ['user','developer'], 'rngPayer'), refundRecipient: oneOf(payment.refundRecipient, ['payer','developer','custom'], 'refundRecipient'), refundAddress: text(payment.refundAddress, 'refundAddress', MAX_ADDRESS_LENGTH), recovery: oneOf(payment.recovery, ['user','developer','both'], 'recovery'), applicationRefund: oneOf(payment.applicationRefund, ['refund-on-expiry','developer-defined'], 'applicationRefund') },
  };
}

export function stableStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize) : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).sort(([a],[b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : input;
  return JSON.stringify(normalize(value), null, 2) + '\n';
}
