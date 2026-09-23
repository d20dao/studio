import { describe, expect, it } from 'vitest';
import { createProject, parseProjectJson, projectSlug, validateProject } from '../src/core/project';
import { appendProject, duplicateProject, importProjects, parseRoute, removeProject, restoreProject, routeHash } from '../src/app/workspace-state';
import type { StudioProject } from '../src/core/types';

describe('versioned projects', () => {
  it('round-trips configured modules and metadata as data', () => {
    const project = createProject('Relic Collection', 'reveal', 'existing');
    project.modules.royalty = { enabled: true, bps: 500, recipient: '0x1111111111111111111111111111111111111111' };
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
  });
  it('rejects unsupported versions and structurally invalid imported fields', () => {
    const project = createProject('Loot', 'lootbox');
    for (const schemaVersion of [1, 2, 3, 5]) expect(() => parseProjectJson(JSON.stringify({ ...project, schemaVersion }))).toThrow('schema');
    expect(() => parseProjectJson(JSON.stringify({ ...project, modules: {} }))).toThrow('premint');
    expect(() => parseProjectJson(JSON.stringify({ ...project, network: 'unknown-chain' }))).toThrow('network');
    expect(() => parseProjectJson(JSON.stringify({ ...project, codeToExecute: 'arbitrary' }))).toThrow('unsupported field');
  });
  it('rejects zero-total loot and duplicate item identities', () => {
    const project = createProject('Loot', 'lootbox');
    project.loot.items.forEach(item => { item.weight = 0; });
    project.loot.items[1].id = project.loot.items[0].id;
    expect(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.path)).toEqual(expect.arrayContaining(['loot.items', 'loot.items.1.id']));
  });
  it('accepts reveal supply above 256 but enforces its chosen premint cap', () => {
    const project = createProject('Collection', 'reveal');
    project.collection.maxSupply = 300;
    project.modules.premint = { enabled: true, quantity: 301, recipient: '0x1111111111111111111111111111111111111111', includeInReveal: true };
    const paths = validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.path);
    expect(paths).toContain('modules.premint.quantity');
    expect(paths).not.toContain('collection.maxSupply');
  });
  it('never derives an export path from raw display-name separators', () => {
    expect(projectSlug({ name: '../../etc/secret' })).not.toContain('/');
    expect(projectSlug({ name: '///' })).toBe('studio-project');
  });
  it('warns about a fully excluded finite premint without blocking batched reveal generation', () => {
    const project = createProject('All preminted', 'reveal');
    project.collection.maxSupply = 128;
    project.modules.premint = { enabled: true, quantity: 128, recipient: '0x1111111111111111111111111111111111111111', includeInReveal: false };
    expect(validateProject(project)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'modules.premint.includeInReveal', severity: 'warning' })]));
    project.collection.maxSupply = null;
    expect(validateProject(project).filter(issue => issue.path === 'modules.premint.includeInReveal')).toEqual([]);
  });
  it('reports structural export/load bounds as validation errors', () => {
    const project = createProject('Loot', 'lootbox');
    project.loot.items[0].metadataUri = `https://example.com/${'a'.repeat(600)}`;
    expect(validateProject(project).some(issue => issue.severity === 'error')).toBe(true);
    expect(() => parseProjectJson(JSON.stringify(project))).toThrow('bounded text');
  });
  it('requires immutable metadata before generating a new reveal but keeps existing adapters optional', () => {
    const project = createProject('Collection', 'reveal');
    expect(validateProject(project).filter(issue => issue.path === 'collection.metadataBaseUri')).toEqual([
      expect.objectContaining({ path: 'collection.metadataBaseUri', severity: 'error' }),
    ]);
    // This remains a storable incomplete draft, not structurally corrupt data.
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
    project.integration = 'existing';
    expect(validateProject(project).filter(issue => issue.path === 'collection.metadataBaseUri')).toEqual([
      expect.objectContaining({ path: 'collection.metadataBaseUri', severity: 'warning' }),
    ]);
    for (const integration of ['new', 'existing'] as const) {
      project.integration = integration;
      project.collection.metadataBaseUri = 'https://metadata.example.invalid/collection/';
      expect(validateProject(project).filter(issue => issue.path === 'collection.metadataBaseUri')).toEqual([]);
    }
  });
  it('identifies each missing new-collection item URI while allowing existing loot integration hooks', () => {
    const project = createProject('Loot', 'lootbox');
    expect(validateProject(project).filter(issue => issue.path.endsWith('.metadataUri')).map(issue => ({ path: issue.path, severity: issue.severity }))).toEqual([
      { path: 'loot.items.0.metadataUri', severity: 'error' },
      { path: 'loot.items.1.metadataUri', severity: 'error' },
      { path: 'loot.items.2.metadataUri', severity: 'error' },
    ]);
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
    project.integration = 'existing';
    expect(validateProject(project).filter(issue => issue.path.endsWith('.metadataUri'))).toEqual([]);
    project.integration = 'new';
    const references = ['https://metadata.example.invalid/items/0.json', 'ipfs://collection/1.json', 'ar://transaction/2.json'];
    project.loot.items.forEach((item, index) => { item.metadataUri = references[index]; });
    expect(validateProject(project).filter(issue => issue.severity === 'error')).toEqual([]);
  });
  it.each(['new', 'existing'] as const)('keeps URI protocol validation for %s integrations', integration => {
    const loot = createProject('Loot', 'lootbox', integration);
    loot.loot.items[1].metadataUri = 'http://metadata.example.invalid/item.json';
    expect(validateProject(loot)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'loot.items.1.metadataUri', severity: 'error' })]));
    const reveal = createProject('Collection', 'reveal', integration);
    reveal.collection.metadataBaseUri = 'javascript:invalid';
    expect(validateProject(reveal)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'collection.metadataBaseUri', severity: 'error' })]));
  });
  it('preserves optional uint256 token IDs without number precision loss', () => {
    const project = createProject('Loot', 'lootbox');
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
    project.loot.items[0].tokenId = ((1n << 256n) - 1n).toString();
    expect(parseProjectJson(JSON.stringify(project)).loot.items[0].tokenId).toBe(project.loot.items[0].tokenId);
    project.loot.items[0].tokenId = (1n << 256n).toString();
    expect(() => parseProjectJson(JSON.stringify(project))).toThrow('uint256');
    project.loot.items[0].tokenId = '001';
    expect(() => parseProjectJson(JSON.stringify(project))).toThrow('uint256');
  });
  it('rejects explicit IDs that collide with row-index defaults', () => {
    const project = createProject('Loot', 'lootbox');
    project.loot.items[1].tokenId = '0';
    expect(validateProject(project)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'loot.items.1.tokenId', severity: 'error' })]));
    project.loot.items[1].tokenId = '10';
    expect(validateProject(project).filter(issue => issue.path.endsWith('.tokenId'))).toEqual([]);
  });
  it('restores a deleted project in its exact position with its original identity and draft', () => {
    const projects = [createProject('One', 'lootbox'), createProject('Two', 'reveal'), createProject('Three', 'lootbox')];
    projects[1].collection.metadataBaseUri = 'ipfs://original';
    const removal = removeProject(projects, projects[1].id);
    expect(removal.projects.map(project => project.name)).toEqual(['One', 'Three']);
    expect(restoreProject(removal.projects, removal.removed)).toEqual(projects);
    expect(() => restoreProject(projects, removal.removed)).toThrow('already exists');
  });
  it('duplicates a project without sharing nested draft data or its original identity', () => {
    const original = createProject('Original', 'lootbox');
    const copy = duplicateProject(original);
    expect(copy.id).not.toBe(original.id);
    copy.loot.items[0].weight = 1;
    expect(original.loot.items[0].weight).toBe(70);
    expect(parseProjectJson(JSON.stringify(copy))).toEqual(copy);
  });
  it('enforces the project limit before additions and can import a complete local backup', () => {
    const projects = Array.from({ length: 100 }, () => createProject('Loot', 'lootbox'));
    expect(() => appendProject(projects, createProject('Extra', 'lootbox'))).toThrow('100');
    expect(importProjects(JSON.stringify({ schemaVersion: 1, projects: projects.slice(0, 2) }))).toEqual(projects.slice(0, 2));
    expect(() => importProjects(JSON.stringify({ schemaVersion: 1, projects: projects.slice(0, 2), futureSetting: true }))).toThrow('unsupported fields');
  });
  it('round-trips project/page routes and falls back safely for deleted or invalid targets', () => {
    const project = createProject('Loot', 'lootbox');
    const route = { projectId: project.id, page: 'files' as const };
    expect(parseRoute(routeHash(route), [project])).toEqual(route);
    expect(parseRoute(routeHash(route), [])).toEqual({ page: 'projects' });
    expect(parseRoute('#/project/%E0%A4%A/files', [project])).toEqual({ page: 'projects' });
    expect(parseRoute('#/new', [project])).toEqual({ page: 'create' });
  });

  it.each(['lootbox', 'reveal'] as const)('starts %s without a default supply cap and round-trips null explicitly', mechanic => {
    const project = createProject('Unlimited', mechanic, 'existing');
    expect(project.schemaVersion).toBe(4);
    expect(project.collection.maxSupply).toBeNull();
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
    expect(importProjects(JSON.stringify(project))).toEqual([project]);
    expect(validateProject(project).filter(issue => issue.path === 'collection.maxSupply')).toEqual([]);
  });

  it.each([257, 1_000_001, Number.MAX_SAFE_INTEGER])('preserves and validates the explicit supply cap %s without arbitrary collection limits', maxSupply => {
    for (const mechanic of ['lootbox', 'reveal'] as const) {
      const project = createProject('Large collection', mechanic, 'existing');
      project.collection.maxSupply = maxSupply;
      expect(parseProjectJson(JSON.stringify(project)).collection.maxSupply).toBe(maxSupply);
      expect(validateProject(project).filter(issue => issue.path === 'collection.maxSupply')).toEqual([]);
    }
  });

  it('keeps an empty limited draft readable while refusing unsafe or nonpositive business caps', () => {
    const project = createProject('Limited draft', 'reveal', 'existing');
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      project.collection.maxSupply = value;
      expect(validateProject(project)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'collection.maxSupply', severity: 'error' })]));
    }
    project.collection.maxSupply = 0;
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
    expect(() => parseProjectJson(JSON.stringify({ ...project, collection: { ...project.collection, maxSupply: 'unlimited' } }))).toThrow('finite number');
  });

  it('validates uncapped premints by safe numeric precision and capped premints against their explicit cap', () => {
    const project = createProject('Unlimited premint', 'lootbox', 'existing');
    project.modules.premint = { enabled: true, quantity: 1_000_001, recipient: '0x1111111111111111111111111111111111111111', includeInReveal: true };
    expect(validateProject(project).filter(issue => issue.path === 'modules.premint.quantity')).toEqual([]);
    project.modules.premint.quantity = Number.MAX_SAFE_INTEGER;
    expect(validateProject(project).filter(issue => issue.path === 'modules.premint.quantity')).toEqual([]);
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      project.modules.premint.quantity = quantity;
      expect(validateProject(project)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'modules.premint.quantity', severity: 'error' })]));
    }
    project.collection.maxSupply = 1_000_001;
    project.modules.premint.quantity = 1_000_001;
    expect(validateProject(project).filter(issue => issue.path === 'modules.premint.quantity')).toEqual([]);
    project.modules.premint.quantity++;
    expect(validateProject(project)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'modules.premint.quantity', severity: 'error' })]));
  });

  it.each(['shuffle', 'offset', 'token-hash'] as const)('round-trips reveal mode %s without imposing a collection cap', mode => {
    const project = createProject('Reveal mode', 'reveal', 'existing');
    project.reveal.mode = mode;
    for (const maxSupply of [null, 1_000_001]) {
      project.collection.maxSupply = maxSupply;
      expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
      expect(importProjects(JSON.stringify(project))).toEqual([project]);
      expect(validateProject(project).filter(issue => ['reveal.mode', 'collection.maxSupply'].includes(issue.path))).toEqual([]);
    }
  });

  it('requires an exact reveal mode and placeholder field and rejects unknown reveal fields', () => {
    const project = createProject('Current mode', 'reveal');
    expect(project.reveal).toEqual({ mode: 'shuffle', unrevealedUri: '' });
    const { reveal: _reveal, ...missing } = project;
    expect(() => parseProjectJson(JSON.stringify(missing))).toThrow('reveal');
    for (const reveal of [{}, { mode: 'shuffle' }, { mode: 'unknown', unrevealedUri: '' }, { mode: 'index-offset', unrevealedUri: '' }, { mode: null, unrevealedUri: '' }, { mode: 'shuffle', unrevealedUri: null }, { mode: 'shuffle', unrevealedUri: '', futureSetting: true }]) {
      expect(() => parseProjectJson(JSON.stringify({ ...project, reveal }))).toThrow();
    }
    project.reveal.mode = 'unknown' as StudioProject['reveal']['mode'];
    expect(validateProject(project)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'reveal.mode', severity: 'error' })]));
  });

  it('accepts only lowercase metadata schemes because onchain URIs are returned verbatim', () => {
    const loot = createProject('Loot', 'lootbox');
    loot.loot.items[0].metadataUri = 'IPFS://collection/0.json';
    loot.loot.items[1].metadataUri = 'HTTPS://metadata.example.invalid/1.json';
    loot.loot.items[2].metadataUri = 'ar://transaction/2.json';
    const paths = validateProject(loot).filter(issue => issue.severity === 'error').map(issue => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['loot.items.0.metadataUri', 'loot.items.1.metadataUri']));
    expect(paths).not.toContain('loot.items.2.metadataUri');
    const reveal = createProject('Collection', 'reveal');
    reveal.collection.metadataBaseUri = 'Ipfs://collection/';
    reveal.reveal.unrevealedUri = 'Https://metadata.example.invalid/hidden.json';
    expect(validateProject(reveal).filter(issue => issue.severity === 'error').map(issue => issue.path)).toEqual(expect.arrayContaining(['collection.metadataBaseUri', 'reveal.unrevealedUri']));
  });

  it('warns about an empty unrevealed placeholder only for a new reveal collection', () => {
    const project = createProject('Collection', 'reveal');
    project.collection.metadataBaseUri = 'ipfs://collection/';
    expect(validateProject(project)).toEqual([expect.objectContaining({ path: 'reveal.unrevealedUri', severity: 'warning' })]);
    project.reveal.unrevealedUri = 'ipfs://collection/unrevealed.json';
    expect(validateProject(project)).toEqual([]);
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
    project.reveal.unrevealedUri = '';
    project.integration = 'existing';
    expect(validateProject(project).filter(issue => issue.path === 'reveal.unrevealedUri')).toEqual([]);
  });

  it('flags selected payment policies that the generated contracts do not implement', () => {
    const project = createProject('Loot', 'lootbox');
    const payment = () => validateProject(project).filter(issue => issue.path.startsWith('payment.'));
    expect(payment()).toEqual([]);
    project.payment.price = '0.000';
    expect(payment()).toEqual([]);
    project.payment.price = '2.5';
    expect(payment()).toEqual([expect.objectContaining({ path: 'payment.price', severity: 'warning', message: expect.stringContaining('_authorizeOpen') })]);
    project.payment.rngPayer = 'developer';
    expect(payment().map(issue => issue.path)).toContain('payment.rngPayer');
    for (const refundRecipient of ['developer', 'custom'] as const) {
      project.payment.refundRecipient = refundRecipient;
      project.payment.refundAddress = '';
      expect(payment()).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'payment.refundAddress', severity: 'error' }),
        expect.objectContaining({ path: 'payment.refundRecipient', severity: 'warning' }),
      ]));
      project.payment.refundAddress = '0x3333333333333333333333333333333333333333';
      expect(payment().filter(issue => issue.severity === 'error')).toEqual([]);
    }
  });
});
