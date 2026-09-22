import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/project';
import { loadWorkspace, saveBrowserWorkspace, saveWorkspace, WORKSPACE_KEY, type StorageAdapter, type WorkspaceLocks } from '../src/core/storage';
import type { StudioProject } from '../src/core/types';

function legacyProject(project: StudioProject, schemaVersion: 1 | 2) {
  const { reveal: _reveal, ...previous } = project;
  return { ...previous, schemaVersion };
}

function memory(initial: string | null = null): StorageAdapter & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== null) values.set(WORKSPACE_KEY, initial);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('local workspace persistence', () => {
  it('preserves corrupted local data instead of replacing it with empty defaults', () => {
    const storage = memory('{corrupted');
    expect(loadWorkspace(storage).error).toBeTruthy();
    expect(saveWorkspace([createProject('New project', 'lootbox')], { expectedSnapshot: '{corrupted' }, storage)).toMatchObject({ ok: false, reason: 'recovery-required' });
    expect(storage.getItem(WORKSPACE_KEY)).toBe('{corrupted');
  });
  it('round-trips multiple distinct local projects', () => {
    const storage = memory();
    const projects = [createProject('Loot', 'lootbox'), createProject('Reveal', 'reveal')];
    expect(saveWorkspace(projects, { expectedSnapshot: null }, storage).ok).toBe(true);
    expect(loadWorkspace(storage).projects).toEqual(projects);
  });
  it('reports quota failure without pretending the draft was saved', () => {
    const storage: StorageAdapter = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(saveWorkspace([createProject('Loot', 'lootbox')], { expectedSnapshot: null }, storage)).toMatchObject({ ok: false, reason: 'unavailable' });
  });
  it('refuses structurally unreadable drafts before writing and accepts the subsequent correction', () => {
    const project = createProject('Loot', 'lootbox');
    const original = JSON.stringify({ schemaVersion: 1, projects: [project] });
    const storage = memory(original);
    project.loot.items[0].metadataUri = `https://example.com/${'a'.repeat(600)}`;
    expect(saveWorkspace([project], { expectedSnapshot: original }, storage)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(storage.getItem(WORKSPACE_KEY)).toBe(original);
    project.loot.items[0].metadataUri = '';
    const items = structuredClone(project.loot.items);
    project.loot.items = Array.from({ length: 257 }, (_, index) => ({ id: `item-${index}`, name: '', weight: 1, metadataUri: '' }));
    expect(saveWorkspace([project], { expectedSnapshot: original }, storage)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(storage.getItem(WORKSPACE_KEY)).toBe(original);
    project.loot.items = items;
    expect(saveWorkspace([project], { expectedSnapshot: original }, storage).ok).toBe(true);
    expect(loadWorkspace(storage).projects).toEqual([project]);
  });
  it('allows business-incomplete drafts without confusing them with corrupt data', () => {
    const project = createProject('', 'lootbox');
    project.payment.price = '';
    project.loot.items = [];
    const storage = memory();
    expect(saveWorkspace([project], { expectedSnapshot: null }, storage).ok).toBe(true);
    expect(loadWorkspace(storage).projects).toEqual([project]);
  });
  it('recovers good projects alongside malformed or future-field records without overwriting the original', () => {
    const valid = createProject('Keep me', 'lootbox');
    const broken = { ...createProject('Future project', 'reveal'), futureSetting: { preserve: true } };
    const original = JSON.stringify({ schemaVersion: 1, projects: [valid, broken] });
    const storage = memory(original);
    const loaded = loadWorkspace(storage);
    expect(loaded.projects).toEqual([valid]);
    expect(loaded.rejectedProjects).toBe(1);
    expect(loaded.snapshot).toBe(original);
    expect(saveWorkspace(loaded.projects, { expectedSnapshot: original }, storage)).toMatchObject({ ok: false, reason: 'recovery-required' });
    expect(storage.getItem(WORKSPACE_KEY)).toBe(original);
    const recovered = saveWorkspace(loaded.projects, { expectedSnapshot: original, recover: true }, storage);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(storage.getItem(recovered.recoveryKey!)).toBe(original);
    expect(loadWorkspace(storage)).toMatchObject({ projects: [valid], rejectedProjects: 0 });
    expect(loadWorkspace(storage).error).toBeUndefined();
  });
  it('does not replace a corrupt original when archiving it fails', () => {
    const storage = memory('{bad');
    const originalSet = storage.setItem;
    storage.setItem = (key, value) => { if (key !== WORKSPACE_KEY) throw new Error('Quota exceeded'); originalSet(key, value); };
    expect(saveWorkspace([], { expectedSnapshot: '{bad', recover: true }, storage)).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(storage.getItem(WORKSPACE_KEY)).toBe('{bad');
  });
  it('rejects a stale second reader instead of silently restoring older project values', () => {
    const original = JSON.stringify({ schemaVersion: 1, projects: [createProject('Original', 'lootbox')] });
    const storage = memory(original);
    const a = loadWorkspace(storage), b = loadWorkspace(storage);
    a.projects[0].name = 'Tab A';
    b.projects[0].payment.price = '2';
    expect(saveWorkspace(a.projects, { expectedSnapshot: a.snapshot }, storage).ok).toBe(true);
    expect(saveWorkspace(b.projects, { expectedSnapshot: b.snapshot }, storage)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(loadWorkspace(storage).projects[0]).toMatchObject({ name: 'Tab A', payment: { price: '0' } });
  });
  it('retains legacy workspace data and assigns a revision on the first protected save', () => {
    const project = createProject('Legacy', 'reveal');
    const original = JSON.stringify({ schemaVersion: 1, projects: [project] });
    const storage = memory(original);
    expect(loadWorkspace(storage)).toMatchObject({ revision: 0, projects: [project] });
    const result = saveWorkspace([project], { expectedSnapshot: original }, storage);
    expect(result).toMatchObject({ ok: true, revision: 1 });
    expect(loadWorkspace(storage).projects).toEqual([project]);
  });
  it('refuses an unlocked browser fallback because a read/write pair is not atomic', async () => {
    const storage = memory();
    expect(await saveBrowserWorkspace([createProject('Draft', 'lootbox')], { expectedSnapshot: null }, { storage, locks: null })).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(storage.getItem(WORKSPACE_KEY)).toBeNull();
  });
  it('holds the browser lock around comparison and write for concurrent readers', async () => {
    const storage = memory();
    let queue: Promise<unknown> = Promise.resolve();
    const names: string[] = [];
    const locks: WorkspaceLocks = { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> {
      names.push(name);
      const next = queue.then(callback);
      queue = next;
      return next;
    } };
    const first = createProject('First', 'lootbox'), second = createProject('Second', 'lootbox');
    const results = await Promise.all([
      saveBrowserWorkspace([first], { expectedSnapshot: null }, { storage, locks }),
      saveBrowserWorkspace([second], { expectedSnapshot: null }, { storage, locks }),
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, reason: 'conflict' });
    expect(names).toEqual([WORKSPACE_KEY, WORKSPACE_KEY]);
    expect(loadWorkspace(storage).projects).toEqual([first]);
  });
  it('does not write an obsolete queued draft after the browser lock is acquired', async () => {
    const storage = memory();
    const locks: WorkspaceLocks = { request: async (_name, callback) => callback() };
    expect(await saveBrowserWorkspace([createProject('Old draft', 'lootbox')], { expectedSnapshot: null }, { storage, locks, isCurrent: () => false })).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(storage.getItem(WORKSPACE_KEY)).toBeNull();
  });

  it('migrates legacy records in memory and preserves the raw snapshot until a normal save', () => {
    const current = createProject('Full legacy project', 'lootbox', 'existing');
    current.collection.maxSupply = 128;
    current.createdAt = '2026-09-22T01:02:03.004Z';
    current.updatedAt = '2026-09-22T05:06:07.008Z';
    current.modules.premint = { enabled: true, quantity: 8, recipient: '0x1111111111111111111111111111111111111111', includeInReveal: false };
    current.modules.royalty = { enabled: true, bps: 600, recipient: '0x2222222222222222222222222222222222222222' };
    current.payment = { price: '1.250000000000000001', rngPayer: 'developer', refundRecipient: 'custom', refundAddress: '0x3333333333333333333333333333333333333333', recovery: 'developer', applicationRefund: 'developer-defined' };
    current.loot.items[1].metadataUri = 'ipfs://retained/metadata.json';
    current.loot.items[1].tokenId = '9007199254740993';
    const legacy = { ...legacyProject(current, 1), loot: { ...current.loot, maxOpenings: 1000 } };
    const other = createProject('Already current', 'reveal');
    const original = JSON.stringify({ schemaVersion: 1, revision: 7, projects: [legacy, other] });
    const storage = memory(original);
    const loaded = loadWorkspace(storage);
    expect(loaded).toMatchObject({ projects: [current, other], snapshot: original, revision: 7, rejectedProjects: 0 });
    expect(loaded.error).toBeUndefined();
    expect(storage.getItem(WORKSPACE_KEY)).toBe(original);
    expect(saveWorkspace(loaded.projects, { expectedSnapshot: loaded.snapshot }, storage)).toMatchObject({ ok: true, revision: 8 });
    const saved = storage.getItem(WORKSPACE_KEY)!;
    expect(saved).not.toContain('maxOpenings');
    expect(JSON.parse(saved)).toMatchObject({ schemaVersion: 1, projects: [{ schemaVersion: 3 }, { schemaVersion: 3 }] });
    expect(loadWorkspace(storage).projects).toEqual([current, other]);
    expect(WORKSPACE_KEY).toBe('d20dao.studio.workspace.v1');
  });

  it('keeps malformed legacy records intact and refuses an ordinary overwrite after partial migration', () => {
    const current = createProject('Good legacy', 'lootbox');
    current.collection.maxSupply = 128;
    const good = { ...legacyProject(current, 1), loot: { ...current.loot, maxOpenings: 1000 } };
    const broken = { ...legacyProject(createProject('Malformed legacy', 'reveal'), 1), loot: { items: [], maxOpenings: 'not a number' } };
    const original = JSON.stringify({ schemaVersion: 1, projects: [good, broken] });
    const storage = memory(original);
    const loaded = loadWorkspace(storage);
    expect(loaded.projects).toEqual([current]);
    expect(loaded.rejectedProjects).toBe(1);
    expect(loaded.snapshot).toBe(original);
    expect(saveWorkspace(loaded.projects, { expectedSnapshot: original }, storage)).toMatchObject({ ok: false, reason: 'recovery-required' });
    expect(storage.getItem(WORKSPACE_KEY)).toBe(original);
  });

  it('retains v1/v2 collection caps beside unlimited v3 projects through the first migrated save', () => {
    const versionOne = createProject('Legacy 128 cap', 'reveal', 'existing');
    versionOne.collection.maxSupply = 128;
    versionOne.isExample = true;
    const versionTwo = createProject('Legacy large cap', 'lootbox', 'existing');
    versionTwo.collection.maxSupply = 1_000_001;
    const unlimited = createProject('No cap', 'reveal', 'existing');
    unlimited.reveal.mode = 'token-hash';
    const original = JSON.stringify({ schemaVersion: 1, projects: [
      { ...legacyProject(versionOne, 1), loot: { ...versionOne.loot, maxOpenings: 1000 } },
      legacyProject(versionTwo, 2),
      unlimited,
    ] });
    const storage = memory(original);
    const loaded = loadWorkspace(storage);
    expect(loaded.error).toBeUndefined();
    expect(loaded.projects).toEqual([versionOne, versionTwo, unlimited]);
    expect(loaded.projects.map(project => project.collection.maxSupply)).toEqual([128, 1_000_001, null]);
    expect(loaded.projects.map(project => project.reveal.mode)).toEqual(['shuffle', 'shuffle', 'token-hash']);
    expect(storage.getItem(WORKSPACE_KEY)).toBe(original);
    expect(saveWorkspace(loaded.projects, { expectedSnapshot: original }, storage).ok).toBe(true);
    expect(loadWorkspace(storage).projects).toEqual([versionOne, versionTwo, unlimited]);
    expect(JSON.parse(storage.getItem(WORKSPACE_KEY)!).projects.every((project: { schemaVersion: number }) => project.schemaVersion === 3)).toBe(true);
  });

  it('persists all current reveal modes and preserves malformed mode records for recovery', () => {
    const projects = (['shuffle', 'offset', 'token-hash'] as const).map(mode => {
      const project = createProject(mode, 'reveal', 'existing');
      project.reveal.mode = mode;
      return project;
    });
    const storage = memory();
    expect(saveWorkspace(projects, { expectedSnapshot: null }, storage).ok).toBe(true);
    expect(loadWorkspace(storage).projects).toEqual(projects);
    const invalid = { ...createProject('Unsupported mode', 'reveal'), reveal: { mode: 'future-mode' } };
    const original = JSON.stringify({ schemaVersion: 1, projects: [...projects, invalid] });
    const recovery = memory(original);
    const loaded = loadWorkspace(recovery);
    expect(loaded.projects).toEqual(projects);
    expect(loaded.rejectedProjects).toBe(1);
    expect(saveWorkspace(loaded.projects, { expectedSnapshot: original }, recovery)).toMatchObject({ ok: false, reason: 'recovery-required' });
    expect(recovery.getItem(WORKSPACE_KEY)).toBe(original);
  });
});
