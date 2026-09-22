import { describe, expect, it } from 'vitest';
import { draftIssueTarget, issueTarget } from '../src/app/issue-navigation';
import { createProject, validateProject } from '../src/core/project';

describe('validation issue navigation', () => {
  it('routes collection, payment and enabled module errors to their real controls', () => {
    const project = createProject('Collection', 'reveal');
    project.modules.premint.enabled = true;
    project.modules.royalty.enabled = true;
    project.payment.refundRecipient = 'custom';
    const cases = [
      ['name', 'overview'], ['collection.standard', 'overview'], ['network', 'overview'],
      ['collection.name', 'mechanic'], ['collection.symbol', 'mechanic'], ['collection.maxSupply', 'mechanic'], ['collection.metadataBaseUri', 'mechanic'],
      ['modules.premint.quantity', 'modules'], ['modules.premint.recipient', 'modules'], ['modules.premint.includeInReveal', 'modules'],
      ['modules.royalty.bps', 'modules'], ['modules.royalty.recipient', 'modules'],
      ['payment.price', 'payment'], ['payment.refundAddress', 'payment'],
    ];
    for (const [path, page] of cases) expect(issueTarget(path, project)).toMatchObject({ path, page });
    expect(issueTarget('collection.maxSupply', project).label).toBe('Maximum supply / token count');
  });

  it('maps every row field to its current schema path and never invents a missing row', () => {
    const project = createProject('Loot', 'lootbox');
    for (const field of ['name', 'metadataUri', 'tokenId', 'weight']) {
      expect(issueTarget(`loot.items.1.${field}`, project)).toMatchObject({ page: 'mechanic', path: `loot.items.1.${field}` });
    }
    expect(issueTarget('loot.items.99.weight', project).path).toBe('loot.items');
    expect(issueTarget('loot.items.1.id', project).path).toBe('loot.items.1.name');
    expect(issueTarget('loot.items.1.unknown', project)).toEqual({ page: 'overview', path: 'name', label: 'Project name' });
  });

  it('takes aggregate errors to the table action or relevant weight and token ID', () => {
    const project = createProject('Loot', 'lootbox');
    project.loot.items[1].weight = -1;
    expect(issueTarget('loot.items', project)).toEqual({ page: 'mechanic', path: 'loot.items', label: 'Add item' });
    expect(issueTarget('loot.weights', project).path).toBe('loot.items.1.weight');
    project.loot.items.forEach(item => { item.weight = 0; });
    expect(issueTarget('weights', project).path).toBe('loot.items.0.weight');
    project.loot.items[0].tokenId = '1'; // Collides with row 1's implicit ID.
    expect(issueTarget('loot.tokenIds', project).path).toBe('loot.items.0.tokenId');
    delete project.loot.items[0].tokenId;
    project.loot.items[2].tokenId = '0';
    expect(issueTarget('loot.items.tokenIds', project).path).toBe('loot.items.2.tokenId');
    project.loot.items = [];
    expect(issueTarget('loot.weights', project).path).toBe('loot.items');
    expect(issueTarget('loot.tokenIds', project).path).toBe('loot.items');
  });

  it('does not target controls hidden by the current mechanic or feature settings', () => {
    const project = createProject('Collection', 'reveal');
    expect(issueTarget('loot.items.1.name', project)).toMatchObject({ page: 'overview', path: 'mechanic' });
    expect(issueTarget('modules.premint.quantity', project).path).toBe('modules.premint.enabled');
    expect(issueTarget('modules.royalty.recipient', project).path).toBe('modules.royalty.enabled');
    expect(issueTarget('payment.refundAddress', project).path).toBe('payment.refundRecipient');
    project.mechanic = 'lootbox';
    expect(issueTarget('collection.metadataBaseUri', project).path).toBe('mechanic');
    expect(issueTarget('collection.maxSupply', project).label).toBe('Maximum collection supply');
  });

  it('routes the validator’s real zero-total aggregate issue to an editable weight', () => {
    const project = createProject('Loot', 'lootbox');
    project.loot.items.forEach(item => { item.weight = 0; });
    const issue = validateProject(project).find(issue => issue.path === 'loot.items');
    expect(issue).toBeDefined();
    expect(issueTarget(issue!.path, project)).toMatchObject({ page: 'mechanic', path: 'loot.items.0.weight' });
    project.loot.items[1].weight = Number.NaN;
    expect(issueTarget('loot.items', project).path).toBe('loot.items.1.weight');
    project.loot.items = [];
    expect(issueTarget('loot.items', project)).toEqual({ page: 'mechanic', path: 'loot.items', label: 'Add item' });
  });

  it('keeps unknown and structurally invalid project paths on a safe overview fallback', () => {
    const project = createProject('Loot', 'lootbox');
    for (const path of ['project', 'future.unknown', '__proto__', 'constructor', 'loot.items.-1.weight']) {
      expect(issueTarget(path, project)).toEqual({ page: 'overview', path: 'name', label: 'Project name' });
    }
  });

  it('resolves all emitted validation issues from a broken business draft', () => {
    const project = createProject('', 'lootbox');
    project.collection.symbol = '';
    project.collection.maxSupply = 0;
    project.collection.standard = 'erc721';
    project.loot.items[0].name = '';
    project.loot.items[1].weight = -1;
    project.loot.items[2].metadataUri = 'bad';
    project.loot.items[2].tokenId = '0';
    project.modules.premint.enabled = true;
    project.modules.royalty.enabled = true;
    project.modules.royalty.bps = 10001;
    project.payment.price = '-1';
    project.payment.refundRecipient = 'custom';
    const issues = validateProject(project);
    expect(issues.length).toBeGreaterThan(10);
    for (const issue of issues) {
      const result = issueTarget(issue.path, project);
      expect(result.path).toBe(issue.path);
      expect(result.label.length).toBeGreaterThan(0);
    }
  });
});

describe('incomplete draft navigation', () => {
  it('follows stable item IDs after reorder and forgets removed rows', () => {
    const project = createProject('Loot', 'lootbox');
    const id = project.loot.items[1].id;
    expect(draftIssueTarget(`weight-${id}`, project)?.path).toBe('loot.items.1.weight');
    project.loot.items.unshift(project.loot.items.pop()!);
    expect(draftIssueTarget(`weight-${id}`, project)?.path).toBe('loot.items.2.weight');
    expect(draftIssueTarget(`token-${id}`, project)?.path).toBe('loot.items.2.tokenId');
    project.loot.items.pop();
    expect(draftIssueTarget(`weight-${id}`, project)).toBeUndefined();
    expect(draftIssueTarget(`token-${id}`, project)).toBeUndefined();
    project.loot.items[1].id = project.loot.items[0].id;
    expect(draftIssueTarget(`weight-${project.loot.items[0].id}`, project)).toBeUndefined();
  });

  it('maps active numeric settings and ignores drafts from hidden or disabled inputs', () => {
    const project = createProject('Loot', 'lootbox');
    expect(draftIssueTarget('max-supply', project)?.path).toBe('collection.maxSupply');
    expect(draftIssueTarget('premint', project)).toBeUndefined();
    expect(draftIssueTarget('royalty', project)).toBeUndefined();
    project.modules.premint.enabled = true;
    project.modules.royalty.enabled = true;
    expect(draftIssueTarget('premint', project)?.path).toBe('modules.premint.quantity');
    expect(draftIssueTarget('royalty', project)?.path).toBe('modules.royalty.bps');
    project.mechanic = 'reveal';
    expect(draftIssueTarget('max-openings', project)).toBeUndefined();
    expect(draftIssueTarget(`weight-${project.loot.items[0].id}`, project)).toBeUndefined();
    expect(draftIssueTarget('max-supply', project)?.path).toBe('collection.maxSupply');
    expect(draftIssueTarget('future-field', project)).toBeUndefined();
  });
});
