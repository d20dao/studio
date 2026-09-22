import { strToU8, zipSync } from 'fflate';
import { projectSlug, stableStringify } from './project';
import type { GeneratedBundle, GeneratedFile, StudioProject } from './types';

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

export function downloadGeneratedFile(file: GeneratedFile): void {
  downloadText(file.path.split('/').pop() || 'studio-file.txt', file.content, file.language === 'json' ? 'application/json' : 'text/plain;charset=utf-8');
}

export function downloadProject(project: StudioProject): void {
  downloadText(`${projectSlug(project)}.studio.json`, stableStringify(project), 'application/json');
}

export function downloadBundle(project: StudioProject, bundle: GeneratedBundle): void {
  if (bundle.projectId !== project.id) throw new Error('Wait for the current project files to finish generating.');
  const snapshot = bundle.files.find(file => file.path === 'studio.project.json');
  if (!snapshot || stableStringify(JSON.parse(snapshot.content)) !== stableStringify(project)) throw new Error('The project has changed. Wait for the updated files before exporting.');
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const file of bundle.files) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(file.path) || file.path.startsWith('/') || file.path.split('/').some(segment => segment === '.' || segment === '..' || segment === '') || entries[file.path]) throw new Error('The bundle contains an invalid or duplicate file path.');
    entries[file.path] = strToU8(file.content);
  }
  const archive = zipSync(entries, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') });
  downloadBlob(`${projectSlug(project)}.zip`, new Blob([new Uint8Array(archive)], { type: 'application/zip' }));
}
