import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/project';
import { loadWorkspace, saveBrowserWorkspace, saveWorkspace, WORKSPACE_KEY, type StorageAdapter, type WorkspaceLocks } from '../src/core/storage';

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
});
