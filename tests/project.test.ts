import { describe, expect, it } from 'vitest';
import { createProject, parseProjectJson, projectSlug, validateProject } from '../src/core/project';
import { appendProject, duplicateProject, importProjects, parseRoute, removeProject, restoreProject, routeHash } from '../src/app/workspace-state';
import type { StudioProject } from '../src/core/types';

function legacyProject(project: StudioProject, schemaVersion: 1 | 2) {
  const { reveal: _reveal, ...previous } = project;
  return { ...previous, schemaVersion };
}

describe('versioned projects', () => {
  it('round-trips configured modules and metadata as data', () => {
    const project = createProject('Relic Collection', 'reveal', 'existing');
    project.modules.royalty = { enabled: true, bps: 500, recipient: '0x1111111111111111111111111111111111111111' };
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
  });
  it('rejects unsupported versions and structurally invalid imported fields', () => {
    const project = createProject('Loot', 'lootbox');
    expect(() => parseProjectJson(JSON.stringify({ ...project, schemaVersion: 4 }))).toThrow('schema');
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
  it('preserves optional uint256 token IDs without number precision loss and supports old files', () => {
    const project = createProject('Loot', 'lootbox');
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
    project.loot.items[0].tokenId = ((1n << 256n) - 1n).toString();
    expect(parseProjectJson(JSON.stringify(project)).loot.items[0].tokenId).toBe(project.loot.items[0].tokenId);
    project.loot.items[0].tokenId = (1n << 256n).toString();
    expect(() => parseProjectJson(JSON.stringify(project))).toThrow('uint256');
    project.loot.items[0].tokenId = '001';
    expect(() => parseProjectJson(JSON.stringify(project))).toThrow('uint256');
  });
  it('rejects explicit IDs that collide with legacy row-index defaults', () => {
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

  it.each(['lootbox', 'reveal'] as const)('migrates a legacy %s project and import without changing any other value', mechanic => {
    const current = createProject('Legacy configured project', mechanic, 'existing');
    current.collection.maxSupply = 128;
    current.createdAt = '2026-09-22T01:02:03.004Z';
    current.updatedAt = '2026-09-22T05:06:07.008Z';
    current.isExample = true;
    current.modules.premint = { enabled: true, quantity: 5, recipient: '0x1111111111111111111111111111111111111111', includeInReveal: false };
    current.modules.royalty = { enabled: true, bps: 750, recipient: '0x2222222222222222222222222222222222222222' };
    current.payment = { price: '2.500000000000000001', rngPayer: 'developer', refundRecipient: 'custom', refundAddress: '0x3333333333333333333333333333333333333333', recovery: 'both', applicationRefund: 'developer-defined' };
    current.loot.items[0].tokenId = ((1n << 256n) - 1n).toString();
    current.loot.items[0].metadataUri = 'ipfs://original/{id}.json';
    const original = JSON.stringify({ ...legacyProject(current, 1), loot: { ...current.loot, maxOpenings: 700 } });
    const migrated = parseProjectJson(original);
    expect(migrated).toEqual(current);
    expect(importProjects(original)).toEqual([current]);
    expect(importProjects(JSON.stringify({ schemaVersion: 1, projects: [JSON.parse(original)] }))).toEqual([current]);
    expect(migrated.schemaVersion).toBe(3);
    expect(JSON.stringify(migrated)).not.toContain('maxOpenings');
    expect(parseProjectJson(JSON.stringify(migrated))).toEqual(current);
  });

  it('accepts absent or finite legacy limits but rejects malformed removed values before migration', () => {
    const project = createProject('Legacy draft', 'lootbox');
    project.collection.maxSupply = 128;
    const legacy = legacyProject(project, 1);
    expect(parseProjectJson(JSON.stringify(legacy))).toEqual(project);
    for (const maxOpenings of [0, -1, 1.5, Number.MAX_VALUE]) {
      expect(parseProjectJson(JSON.stringify({ ...legacy, loot: { ...legacy.loot, maxOpenings } }))).toEqual(project);
    }
    for (const maxOpenings of [null, '1000', true, {}, []]) {
      expect(() => parseProjectJson(JSON.stringify({ ...legacy, loot: { ...legacy.loot, maxOpenings } }))).toThrow('finite number');
    }
    const overflow = JSON.stringify({ ...legacy, loot: { ...legacy.loot, maxOpenings: 1000 } }).replace('"maxOpenings":1000', '"maxOpenings":1e999');
    expect(() => parseProjectJson(overflow)).toThrow('finite number');
  });

  it('never accepts the removed field in current schemas or strips unrelated legacy fields', () => {
    const project = createProject('Current project', 'lootbox');
    project.collection.maxSupply = 128;
    expect(project.schemaVersion).toBe(3);
    expect(project.loot).not.toHaveProperty('maxOpenings');
    expect(() => parseProjectJson(JSON.stringify({ ...project, loot: { ...project.loot, maxOpenings: 1000 } }))).toThrow('unsupported field');
    expect(() => parseProjectJson(JSON.stringify({ ...legacyProject(project, 2), loot: { ...project.loot, maxOpenings: 1000 } }))).toThrow('unsupported field');
    expect(() => parseProjectJson(JSON.stringify({ ...legacyProject(project, 1), loot: { ...project.loot, maxOpenings: 1000, futureSetting: true } }))).toThrow('unsupported field');
  });

  it.each(['lootbox', 'reveal'] as const)('starts %s without a default supply cap and round-trips null explicitly', mechanic => {
    const project = createProject('Unlimited', mechanic, 'existing');
    expect(project.schemaVersion).toBe(3);
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
      for (const schemaVersion of [1, 2] as const) {
        const migrated = parseProjectJson(JSON.stringify(legacyProject(project, schemaVersion)));
        expect(migrated).toEqual(project);
        expect(migrated.collection.maxSupply).toBe(maxSupply);
      }
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
    for (const schemaVersion of [1, 2] as const) {
      expect(() => parseProjectJson(JSON.stringify({ ...legacyProject(project, schemaVersion), collection: { ...project.collection, maxSupply: null } }))).toThrow('finite number');
    }
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

  it.each([1, 2] as const)('defaults actual schema %s projects to shuffle while preserving their other choices', schemaVersion => {
    const current = createProject('Legacy mode', 'reveal', 'existing');
    current.collection.maxSupply = 256;
    current.modules.premint = { enabled: true, quantity: 3, recipient: '0x1111111111111111111111111111111111111111', includeInReveal: false };
    const legacy = legacyProject(current, schemaVersion);
    expect(legacy).not.toHaveProperty('reveal');
    const migrated = parseProjectJson(JSON.stringify(legacy));
    expect(migrated).toEqual(current);
    expect(migrated.reveal.mode).toBe('shuffle');
    expect(() => parseProjectJson(JSON.stringify({ ...legacy, reveal: { mode: 'offset' } }))).toThrow('unsupported field');
  });

  it('requires an exact schema 3 reveal mode and rejects unknown reveal fields', () => {
    const project = createProject('Current mode', 'reveal');
    expect(project.reveal.mode).toBe('shuffle');
    const { reveal: _reveal, ...missing } = project;
    expect(() => parseProjectJson(JSON.stringify(missing))).toThrow('reveal');
    for (const reveal of [{}, { mode: 'unknown' }, { mode: 'index-offset' }, { mode: null }, { mode: 'shuffle', futureSetting: true }]) {
      expect(() => parseProjectJson(JSON.stringify({ ...project, reveal }))).toThrow();
    }
    project.reveal.mode = 'unknown' as StudioProject['reveal']['mode'];
    expect(validateProject(project)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'reveal.mode', severity: 'error' })]));
  });
});
