import { describe, expect, it } from 'vitest';
import { createProject, parseProjectJson, projectSlug, validateProject } from '../src/core/project';
import { appendProject, duplicateProject, importProjects, parseRoute, removeProject, restoreProject, routeHash } from '../src/app/workspace-state';

describe('versioned projects', () => {
  it('round-trips configured modules and metadata as data', () => {
    const project = createProject('Relic Collection', 'reveal', 'existing');
    project.modules.royalty = { enabled: true, bps: 500, recipient: '0x1111111111111111111111111111111111111111' };
    expect(parseProjectJson(JSON.stringify(project))).toEqual(project);
  });
  it('rejects unsupported versions and structurally invalid imported fields', () => {
    const project = createProject('Loot', 'lootbox');
    expect(() => parseProjectJson(JSON.stringify({ ...project, schemaVersion: 2 }))).toThrow('schema');
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
  it('enforces reveal limits and premint supply rather than only validating inputs independently', () => {
    const project = createProject('Collection', 'reveal');
    project.collection.maxSupply = 300;
    project.modules.premint = { enabled: true, quantity: 301, recipient: '0x1111111111111111111111111111111111111111', includeInReveal: true };
    expect(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.path)).toEqual(expect.arrayContaining(['collection.maxSupply', 'modules.premint.quantity']));
  });
  it('never derives an export path from raw display-name separators', () => {
    expect(projectSlug({ name: '../../etc/secret' })).not.toContain('/');
    expect(projectSlug({ name: '///' })).toBe('studio-project');
  });
  it('reports an empty eligible reveal set in form validation before export', () => {
    const project = createProject('All preminted', 'reveal');
    project.modules.premint = { enabled: true, quantity: 128, recipient: '0x1111111111111111111111111111111111111111', includeInReveal: false };
    expect(validateProject(project)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'modules.premint.includeInReveal', severity: 'error' })]));
  });
  it('reports structural export/load bounds as validation errors', () => {
    const project = createProject('Loot', 'lootbox');
    project.loot.items[0].metadataUri = `https://example.com/${'a'.repeat(600)}`;
    expect(validateProject(project).some(issue => issue.severity === 'error')).toBe(true);
    expect(() => parseProjectJson(JSON.stringify(project))).toThrow('bounded text');
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
});
