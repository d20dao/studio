import { loadWorkspace, MAX_PROJECTS, MAX_WORKSPACE_BYTES, validateWorkspaceDraft } from '../core/storage';
import { parseProjectJson } from '../core/project';
import type { StudioProject } from '../core/types';

export type Page = 'projects' | 'create' | 'overview' | 'mechanic' | 'payment' | 'modules' | 'files' | 'agent';
export interface WorkspaceRoute { page: Page; projectId?: string }
export const VIEW_KEY = 'd20dao.studio.last-view.v1';
const projectPages = new Set<Page>(['overview', 'mechanic', 'payment', 'modules', 'files', 'agent']);

export function routeHash(route: WorkspaceRoute): string {
  if (route.page === 'create') return '#/new';
  return route.projectId && projectPages.has(route.page) ? `#/project/${encodeURIComponent(route.projectId)}/${route.page}` : '#/projects';
}

export function parseRoute(hash: string, projects: StudioProject[]): WorkspaceRoute {
  if (hash === '#/new') return { page: 'create' };
  const match = /^#\/project\/([^/]+)\/([^/]+)$/.exec(hash);
  if (match) {
    try {
      const projectId = decodeURIComponent(match[1]);
      const page = match[2] as Page;
      if (projects.some(project => project.id === projectId) && projectPages.has(page)) return { page, projectId };
    } catch { /* A malformed or deleted-project URL falls back to the list. */ }
  }
  return { page: 'projects' };
}

export function appendProject(projects: StudioProject[], project: StudioProject): StudioProject[] {
  if (projects.length >= MAX_PROJECTS) throw new Error(`This workspace holds at most ${MAX_PROJECTS} projects. Download and remove a project before adding another.`);
  const next = [...projects, project];
  validateWorkspaceDraft(next);
  return next;
}

/** Both a single-project export and a complete local draft backup can be reopened. */
export function importProjects(input: string): StudioProject[] {
  if (new TextEncoder().encode(input).byteLength > MAX_WORKSPACE_BYTES) throw new Error('Choose a project or workspace JSON smaller than 4 MB.');
  let data: unknown;
  try { data = JSON.parse(input); } catch { throw new Error('The imported file is not valid JSON.'); }
  if (data && typeof data === 'object' && 'projects' in data) {
    const loaded = loadWorkspace({ getItem: () => input, setItem: () => { throw new Error('Import must not write storage.'); } });
    if (loaded.error) throw new Error(`This backup contains records that need recovery. ${loaded.error}`);
    return loaded.projects;
  }
  return [parseProjectJson(input)];
}

export function duplicateProject(project: StudioProject): StudioProject {
  const now = new Date().toISOString();
  return { ...structuredClone(project), id: crypto.randomUUID(), name: `${project.name.slice(0, 75)} copy`, createdAt: now, updatedAt: now, isExample: false };
}

export interface RemovedProject { project: StudioProject; index: number }
export function removeProject(projects: StudioProject[], id: string): { projects: StudioProject[]; removed: RemovedProject } {
  const index = projects.findIndex(project => project.id === id);
  if (index < 0) throw new Error('The project is no longer in this workspace.');
  return { projects: projects.filter(project => project.id !== id), removed: { project: structuredClone(projects[index]), index } };
}

export function restoreProject(projects: StudioProject[], removed: RemovedProject): StudioProject[] {
  if (projects.some(project => project.id === removed.project.id)) throw new Error('A project with this identity already exists. The deleted copy has not been overwritten.');
  const next = [...projects];
  next.splice(Math.min(removed.index, next.length), 0, structuredClone(removed.project));
  validateWorkspaceDraft(next);
  return next;
}
