import { parseProjectJson } from './project';
import type { StudioProject } from './types';

export const WORKSPACE_KEY = 'd20dao.studio.workspace.v1';
export const RECOVERY_KEY_PREFIX = `${WORKSPACE_KEY}.recovery.`;
export const MAX_WORKSPACE_BYTES = 4 * 1024 * 1024;
export const MAX_PROJECTS = 100;
export interface StorageAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface LoadedWorkspace {
  projects: StudioProject[];
  exists: boolean;
  /** Exact original bytes: both the concurrency token and recovery download. */
  snapshot: string | null;
  revision: number;
  error?: string;
  rejectedProjects: number;
}
export interface SaveOptions {
  expectedSnapshot: string | null;
  /** An explicit recovery action archives the original before replacing it. */
  recover?: boolean;
}
export type SaveResult =
  | { ok: true; snapshot: string; revision: number; recoveryKey?: string }
  | { ok: false; reason: 'conflict' | 'recovery-required' | 'invalid' | 'unavailable' | 'cancelled'; error: string };
const byteSize = (text: string) => new TextEncoder().encode(text).byteLength;

export function loadWorkspace(storage?: StorageAdapter): LoadedWorkspace {
  let raw: string | null = null;
  const base = (): LoadedWorkspace => ({ projects: [], exists: raw !== null, snapshot: raw, revision: 0, rejectedProjects: 0 });
  try {
    raw = (storage ?? window.localStorage).getItem(WORKSPACE_KEY);
    if (raw === null) return base();
    if (byteSize(raw) > MAX_WORKSPACE_BYTES) throw new Error('The stored workspace exceeds the 4 MB limit.');
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !('schemaVersion' in data) || data.schemaVersion !== 1 || !('projects' in data) || !Array.isArray(data.projects)) throw new Error('The stored workspace has an unsupported format.');
    const errors: string[] = [];
    const record = data as Record<string, unknown>;
    if (Object.keys(record).some(key => !['schemaVersion', 'revision', 'projects'].includes(key))) errors.push('The workspace contains unsupported fields.');
    const revision = record.revision ?? 0;
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) errors.push('The workspace revision is invalid.');
    if (data.projects.length > MAX_PROJECTS) errors.push(`Only the first ${MAX_PROJECTS} project records can be recovered here.`);
    const projects: StudioProject[] = [];
    const ids = new Set<string>();
    let rejectedProjects = Math.max(0, data.projects.length - MAX_PROJECTS);
    for (const item of data.projects.slice(0, MAX_PROJECTS)) {
      try {
        const project = parseProjectJson(JSON.stringify(item));
        if (ids.has(project.id)) throw new Error('Duplicate project identity.');
        ids.add(project.id);
        projects.push(project);
      } catch { rejectedProjects++; }
    }
    if (rejectedProjects) errors.push(`${rejectedProjects} project record${rejectedProjects === 1 ? '' : 's'} could not be opened.`);
    return {
      projects, exists: true, snapshot: raw,
      revision: typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      rejectedProjects,
      ...(errors.length ? { error: `${errors.join(' ')} The original data is preserved. Download it before choosing a recovery action.` } : {}),
    };
  } catch (cause) {
    return { ...base(), exists: true, error: `${cause instanceof Error ? cause.message : 'Local projects could not be read.'} Stored data has not been changed.` };
  }
}

/** Business-incomplete drafts are allowed; structurally unreadable data is not. */
export function validateWorkspaceDraft(projects: StudioProject[]): void {
  if (projects.length > MAX_PROJECTS) throw new Error(`Keep at most ${MAX_PROJECTS} projects in this workspace.`);
  const ids = new Set<string>();
  for (const project of projects) {
    const decoded = parseProjectJson(JSON.stringify(project));
    if (ids.has(decoded.id)) throw new Error('Project identities must be unique.');
    ids.add(decoded.id);
  }
  if (byteSize(JSON.stringify({ schemaVersion: 1, revision: Number.MAX_SAFE_INTEGER, projects })) > MAX_WORKSPACE_BYTES) throw new Error('The workspace exceeds the 4 MB limit. Download or remove a project before adding more.');
}

/** Synchronous transaction body. Browser callers MUST hold the workspace Web Lock. */
export function saveWorkspace(projects: StudioProject[], options: SaveOptions, storage?: StorageAdapter): SaveResult {
  try { validateWorkspaceDraft(projects); }
  catch (cause) { return { ok: false, reason: 'invalid', error: cause instanceof Error ? cause.message : 'The draft cannot be saved.' }; }
  try {
    const target = storage ?? window.localStorage;
    const loaded = loadWorkspace(target);
    if (loaded.snapshot !== options.expectedSnapshot) return { ok: false, reason: 'conflict', error: 'Another tab changed the workspace. Download this draft or load the latest saved projects.' };
    if (loaded.error && !options.recover) return { ok: false, reason: 'recovery-required', error: loaded.error };
    const revision = loaded.revision + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('Workspace revision limit reached. Export your projects before starting a new workspace.');
    const snapshot = JSON.stringify({ schemaVersion: 1, revision, projects });
    let recoveryKey: string | undefined;
    if (loaded.error && loaded.snapshot !== null) {
      recoveryKey = `${RECOVERY_KEY_PREFIX}${crypto.randomUUID()}`;
      target.setItem(recoveryKey, loaded.snapshot);
      if (target.getItem(recoveryKey) !== loaded.snapshot) throw new Error('The original workspace backup could not be verified.');
    }
    if (target.getItem(WORKSPACE_KEY) !== options.expectedSnapshot) return { ok: false, reason: 'conflict', error: 'The saved workspace changed. Load the latest projects before saving.' };
    target.setItem(WORKSPACE_KEY, snapshot);
    if (target.getItem(WORKSPACE_KEY) !== snapshot) return { ok: false, reason: 'conflict', error: 'Another client changed the workspace during saving. Your draft remains in memory.' };
    return { ok: true, snapshot, revision, ...(recoveryKey ? { recoveryKey } : {}) };
  } catch (cause) {
    return { ok: false, reason: 'unavailable', error: `Local saving failed. ${cause instanceof Error ? cause.message : ''} Download your draft before closing this tab.` };
  }
}

export interface WorkspaceLocks { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> }

/** No unlocked fallback: localStorage has no atomic compare-and-set operation. */
export async function saveBrowserWorkspace(
  projects: StudioProject[], options: SaveOptions,
  environment: { storage?: StorageAdapter; locks?: WorkspaceLocks | null; isCurrent?: () => boolean } = {},
): Promise<SaveResult> {
  const locks = 'locks' in environment ? environment.locks : (typeof navigator !== 'undefined' ? navigator.locks : undefined);
  if (!locks) return { ok: false, reason: 'unavailable', error: 'This browser cannot coordinate local saves across tabs. Your draft is in memory; download it before closing this tab.' };
  try {
    return await locks.request(WORKSPACE_KEY, () => {
      if (environment.isCurrent && !environment.isCurrent()) return { ok: false, reason: 'cancelled', error: 'A newer draft replaced this save.' };
      return saveWorkspace(projects, options, environment.storage);
    });
  } catch { return { ok: false, reason: 'unavailable', error: 'The local save lock could not be acquired. Download your draft before closing this tab.' }; }
}
