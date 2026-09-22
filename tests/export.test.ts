import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { downloadBundle } from '../src/core/export';
import { generateProject } from '../src/core/generate';
import { createProject } from '../src/core/project';
import type { GeneratedBundle, StudioProject } from '../src/core/types';

let captured: Blob | undefined;
let anchor: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
let append: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); captured = undefined;
  anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  append = vi.fn();
  vi.stubGlobal('document', { createElement: vi.fn((tag: string) => { expect(tag).toBe('a'); return anchor; }), body: { append } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob as Blob; return 'blob:studio-test-archive'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function archive(project: StudioProject, bundle: GeneratedBundle): Promise<Record<string, string>> {
  downloadBundle(project, bundle);
  expect(captured).toBeInstanceOf(Blob);
  expect(captured!.type).toBe('application/zip');
  const entries = unzipSync(new Uint8Array(await captured!.arrayBuffer()));
  const decoded = Object.fromEntries(Object.entries(entries).map(([path, bytes]) => [path, strFromU8(bytes)]));
  expect(Object.keys(decoded).sort()).toEqual(bundle.files.map(file => file.path).sort());
  for (const file of bundle.files) expect(decoded[file.path], file.path).toBe(file.content);
  expect(JSON.parse(decoded['studio.project.json'])).toEqual(project);
  for (const path of ['config/items.json', 'package.json', 'AGENTS.md', 'AGENT_PROMPT.md', 'README.md', 'GENERATION-MANIFEST.json']) expect(decoded[path], path).toBeTruthy();
  return decoded;
}
function noDownload(): void {
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled(); expect(anchor.click).not.toHaveBeenCalled();
}
function configuredProject(name: string, mechanic: StudioProject['mechanic'] = 'lootbox'): StudioProject {
  const project = createProject(name, mechanic, 'new');
  project.collection.metadataBaseUri = 'https://metadata.example.invalid/collection/';
  project.loot.items.forEach((item, index) => { item.metadataUri = `https://metadata.example.invalid/items/${index}.json`; });
  return project;
}

describe('complete project ZIP exports', () => {
  it.each(['lootbox', 'reveal'] as const)('round-trips every new %s collection file and UTF-8 configuration', async mechanic => {
    const project = configuredProject('Crate – café 🎲', mechanic);
    project.loot.items[0].name = 'Épée 🎲';
    const bundle = await generateProject(project);
    expect(bundle.kind).toBe('starter');
    const decoded = await archive(project, bundle);
    const prefix = mechanic === 'lootbox' ? 'D20Loot' : 'D20Reveal';
    expect(decoded[`contracts/${prefix}Collection.sol`]).toContain(`contract ${prefix}Collection`);
    expect(decoded[`contracts/${prefix}Starter.sol`]).toContain(`contract ${prefix}Starter`);
    expect(JSON.parse(decoded['studio.project.json']).name).toBe('Crate – café 🎲');
  });
  it.each(['lootbox', 'reveal'] as const)('exports the existing %s adapter and instructions without a replacement collection', async mechanic => {
    const project = createProject('Existing integration', mechanic, 'existing');
    const bundle = await generateProject(project);
    expect(bundle.kind).toBe('starter');
    const decoded = await archive(project, bundle);
    const sources = Object.keys(decoded).filter(path => path.endsWith('.sol'));
    expect(sources).toEqual([`contracts/${mechanic === 'lootbox' ? 'D20Loot' : 'D20Reveal'}Starter.sol`]);
    expect(decoded['AGENTS.md']).toContain('Existing-project integration:');
  });
  it('exports a complete invalid-configuration plan with no Solidity', async () => {
    const project = createProject('Incomplete table', 'lootbox'); project.loot.items = [];
    const bundle = await generateProject(project); expect(bundle.kind).toBe('plan');
    const decoded = await archive(project, bundle);
    expect(Object.keys(decoded).some(path => path.endsWith('.sol'))).toBe(false);
    expect(JSON.parse(decoded['GENERATION-MANIFEST.json']).kind).toBe('plan');
    expect(decoded['README.md']).toContain('Planning export only');
  });
  it.each(['lootbox', 'reveal'] as const)('exports missing immutable %s metadata as a plan, not a permanent empty-URI contract', async mechanic => {
    const project = createProject('Missing final metadata', mechanic, 'new');
    const bundle = await generateProject(project);
    expect(bundle.kind).toBe('plan');
    const decoded = await archive(project, bundle);
    expect(Object.keys(decoded).some(path => path.endsWith('.sol'))).toBe(false);
    expect(JSON.parse(decoded['GENERATION-MANIFEST.json']).validation).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: mechanic === 'reveal' ? 'collection.metadataBaseUri' : 'loot.items.0.metadataUri', severity: 'error' }),
    ]));
  });
  it('starts a named download and releases its temporary object URL', async () => {
    const project = configuredProject('My Export'); const bundle = await generateProject(project);
    await archive(project, bundle);
    expect(anchor.download).toBe('my-export.zip'); expect(anchor.href).toBe('blob:studio-test-archive');
    expect(append).toHaveBeenCalledWith(anchor); expect(anchor.click).toHaveBeenCalledOnce(); expect(anchor.remove).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); vi.advanceTimersByTime(2000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:studio-test-archive');
  });
});

describe('ZIP export refuses stale or unsafe bundles before downloading', () => {
  it.each(['configuration', 'timestamp', 'identity'] as const)('rejects a stale %s snapshot', async change => {
    const project = configuredProject('Original'); const bundle = await generateProject(project);
    if (change === 'configuration') project.loot.items[0].weight++;
    else if (change === 'timestamp') project.updatedAt = '2026-10-01T00:00:00.000Z';
    else project.id = 'different-project';
    expect(() => downloadBundle(project, bundle)).toThrow(); noDownload();
  });
  it('rejects a bundle missing its project snapshot', async () => {
    const project = configuredProject('No snapshot'); const bundle = await generateProject(project);
    bundle.files = bundle.files.filter(file => file.path !== 'studio.project.json');
    expect(() => downloadBundle(project, bundle)).toThrow(); noDownload();
  });
  it.each(['../escape.sol', '/absolute.sol', 'contracts/../escape.sol', 'contracts//file.sol', 'contracts/./file.sol', 'contracts\\file.sol', 'C:/file.sol', 'bad\u0000file.sol', ''])('rejects unsafe archive path %j', async path => {
    const project = configuredProject('Unsafe path'); const bundle = await generateProject(project);
    bundle.files.push({ path, content: 'untrusted', language: 'text' });
    expect(() => downloadBundle(project, bundle)).toThrow('invalid or duplicate file path'); noDownload();
  });
  it('rejects duplicate archive entries instead of overwriting file contents', async () => {
    const project = configuredProject('Duplicate path'); const bundle = await generateProject(project);
    bundle.files.push({ path: 'AGENTS.md', content: 'replacement instructions', language: 'markdown' });
    expect(() => downloadBundle(project, bundle)).toThrow('invalid or duplicate file path'); noDownload();
  });
});
