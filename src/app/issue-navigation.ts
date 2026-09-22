import { isTokenId } from '../core/project';
import type { StudioProject } from '../core/types';

export interface IssueTarget {
  page: 'overview' | 'mechanic' | 'payment' | 'modules';
  /** Matches the real control's data-field-path, not a display label. */
  path: string;
  label: string;
}

const target = (page: IssueTarget['page'], path: string, label: string): IssueTarget => ({ page, path, label });
const fallback = () => target('overview', 'name', 'Project name');
const mechanicChoice = () => target('overview', 'mechanic', 'Mechanic');
const itemList = () => target('mechanic', 'loot.items', 'Add item');

function rowTarget(index: number, field: 'name' | 'metadataUri' | 'tokenId' | 'weight', project: StudioProject): IssueTarget {
  if (project.mechanic !== 'lootbox') return mechanicChoice();
  if (!Number.isSafeInteger(index) || index < 0 || index >= project.loot.items.length) return itemList();
  const labels = { name: 'name', metadataUri: 'metadata URI', tokenId: 'token ID', weight: 'weight' };
  return target('mechanic', `loot.items.${index}.${field}`, `Item ${index + 1} ${labels[field]}`);
}

function weightTarget(project: StudioProject): IssueTarget {
  const index = project.loot.items.findIndex(item => !Number.isSafeInteger(item.weight) || item.weight < 0 || item.weight > 1_000_000);
  // A zero-total table is repaired by assigning a positive weight to any row.
  return rowTarget(index < 0 ? 0 : index, 'weight', project);
}

function tokenTarget(project: StudioProject): IssueTarget {
  const seen = new Map<string, number>();
  for (const [index, item] of project.loot.items.entries()) {
    const id = item.tokenId ?? String(index);
    if (!isTokenId(id)) return rowTarget(index, 'tokenId', project);
    const previous = seen.get(id);
    if (previous !== undefined) {
      // When an explicit ID collides with a legacy row-index default, take
      // the user to the explicit value that introduced the collision.
      const editable = item.tokenId !== undefined || project.loot.items[previous].tokenId === undefined ? index : previous;
      return rowTarget(editable, 'tokenId', project);
    }
    seen.set(id, index);
  }
  return rowTarget(0, 'tokenId', project);
}

/** Resolve a validation issue to a currently reachable configuration control. */
export function issueTarget(path: string, project: StudioProject): IssueTarget {
  const direct: Record<string, IssueTarget> = {
    name: fallback(),
    mechanic: mechanicChoice(),
    integration: target('overview', 'integration', 'Generation target'),
    network: target('overview', 'network', 'Target network'),
    'collection.name': target('mechanic', 'collection.name', 'Collection name'),
    'collection.symbol': target('mechanic', 'collection.symbol', 'Symbol'),
    'collection.standard': target('overview', 'collection.standard', 'Asset standard'),
    'collection.maxSupply': target('mechanic', 'collection.maxSupply', project.mechanic === 'reveal' ? 'Maximum supply / token count' : 'Maximum collection supply'),
    'collection.metadataBaseUri': project.mechanic === 'reveal' ? target('mechanic', 'collection.metadataBaseUri', 'Metadata base URI') : mechanicChoice(),
    'payment.price': target('payment', 'payment.price', 'Application price'),
    'payment.rngPayer': target('payment', 'payment.rngPayer', 'RNG fee payer'),
    'payment.refundRecipient': target('payment', 'payment.refundRecipient', 'Fixed refund recipient policy'),
    'payment.refundAddress': project.payment.refundRecipient === 'payer' ? target('payment', 'payment.refundRecipient', 'Fixed refund recipient policy') : target('payment', 'payment.refundAddress', 'Public refund recipient address'),
    'payment.recovery': target('payment', 'payment.recovery', 'Recovery handled by'),
    'payment.applicationRefund': target('payment', 'payment.applicationRefund', 'Application payment on expiry'),
  };
  if (Object.hasOwn(direct, path)) return direct[path];

  if (['loot.items', 'items'].includes(path)) {
    if (project.mechanic !== 'lootbox') return mechanicChoice();
    const total = project.loot.items.reduce((sum, item) => sum + item.weight, 0);
    return project.loot.items.length > 0 && (!Number.isSafeInteger(total) || total <= 0) ? weightTarget(project) : itemList();
  }
  if (['loot.weights', 'loot.items.weights', 'weights'].includes(path)) return weightTarget(project);
  if (['loot.tokenIds', 'loot.items.tokenIds', 'tokenIds'].includes(path)) return tokenTarget(project);

  const row = /^loot\.items\.(\d+)\.(name|metadataUri|tokenId|weight|id)$/.exec(path);
  if (row) {
    // Stable internal IDs are not editable. Focus the affected row's name
    // so its existing remove/replace controls are in view, without inventing an ID editor.
    if (row[2] === 'id') return rowTarget(Number(row[1]), 'name', project);
    return rowTarget(Number(row[1]), row[2] as 'name' | 'metadataUri' | 'tokenId' | 'weight', project);
  }

  const module = /^modules\.(premint|royalty)\.(enabled|quantity|recipient|includeInReveal|bps)$/.exec(path);
  if (module) {
    const name = module[1] as 'premint' | 'royalty';
    const field = module[2];
    const allowed = name === 'premint' ? ['enabled', 'quantity', 'recipient', 'includeInReveal'] : ['enabled', 'bps', 'recipient'];
    if (!allowed.includes(field)) return fallback();
    const enabledPath = `modules.${name}.enabled`;
    if (!project.modules[name].enabled || field === 'enabled') return target('modules', enabledPath, name === 'premint' ? 'Enable premint' : 'Enable royalties');
    if (field === 'includeInReveal' && project.mechanic !== 'reveal') return mechanicChoice();
    const labels: Record<string, string> = { quantity: 'Premint quantity', includeInReveal: 'Include premints in reveal', bps: 'Royalty rate', recipient: name === 'premint' ? 'Allocation recipient' : 'Royalty receiver' };
    return target('modules', path, labels[field]);
  }
  return fallback();
}

/** Draft field identities follow item IDs across reorder, never stale row indices. */
export function draftIssueTarget(fieldKey: string, project: StudioProject): IssueTarget | undefined {
  if (fieldKey === 'max-supply') return issueTarget('collection.maxSupply', project);
  if (fieldKey === 'premint') return project.modules.premint.enabled ? issueTarget('modules.premint.quantity', project) : undefined;
  if (fieldKey === 'royalty') return project.modules.royalty.enabled ? issueTarget('modules.royalty.bps', project) : undefined;
  if (project.mechanic !== 'lootbox') return undefined;
  const row = /^(weight|token)-(.+)$/.exec(fieldKey);
  if (!row) return undefined;
  const index = project.loot.items.findIndex(item => item.id === row[2]);
  if (index < 0 || project.loot.items.some((item, other) => other !== index && item.id === row[2])) return undefined;
  return rowTarget(index, row[1] === 'weight' ? 'weight' : 'tokenId', project);
}
