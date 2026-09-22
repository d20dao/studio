import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeneratedBundle, IntegrationTarget, Mechanic, StudioProject } from '../core/types';
import { createProject, stableStringify, validateProject } from '../core/project';
import { MAX_PROJECTS, MAX_WORKSPACE_BYTES } from '../core/storage';
import { generateProject } from '../core/generate';
import { downloadProject, downloadText } from '../core/export';
import { BrandMark } from '../components/BrandMark';
import { Choices, Field } from '../components/Fields';
import { ConfigEditor } from './ConfigEditor';
import type { ConfigPage } from './ConfigEditor';
import { FileWorkspace } from './FileWorkspace';
import { appendProject, duplicateProject, importProjects, removeProject, restoreProject } from './workspace-state';
import type { Page, RemovedProject } from './workspace-state';
import { useWorkspace } from './useWorkspace';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import '../styles/projects.css';

export function App() {
  const [message, setMessage] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const blockedDraft = Object.values(formErrors).some(Boolean);
  const workspace = useWorkspace(blockedDraft);
  const { projects, error: storageError } = workspace;
  const { route, navigate: navigateRoute } = useWorkspaceRoute(projects, blockedDraft, setMessage);
  const { page, projectId: active } = route;
  const [removed, setRemoved] = useState<RemovedProject>();
  const [deleteId, setDeleteId] = useState<string>();
  const [confirmStorage, setConfirmStorage] = useState<'load' | 'recover'>();
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [bundleState, setBundleState] = useState<{ source: StudioProject; bundle: GeneratedBundle }>();
  const [generationError, setGenerationError] = useState('');
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const [newName, setNewName] = useState('');
  const [newMechanic, setNewMechanic] = useState<Mechanic>('lootbox');
  const [newTarget, setNewTarget] = useState<IntegrationTarget>('new');
  const importInput = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const project = projects.find(p => p.id === active);
  const canAdd = projects.length < MAX_PROJECTS;
  const issues = project ? validateProject(project) : [];
  const report = useCallback((key: string, invalid: boolean) => setFormErrors(previous => ({ ...previous, [key]: invalid })), []);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => {
    if (!project || blockedDraft) return;
    let cancelled = false;
    setGenerationError('');
    generateProject(project).then(bundle => { if (!cancelled) setBundleState({ source: project, bundle }); }).catch(error => { if (!cancelled) setGenerationError(error instanceof Error ? error.message : 'Could not generate files.'); });
    return () => { cancelled = true; };
  }, [project, blockedDraft, generationAttempt]);
  function navigate(next: Page) {
    if (!navigateRoute({ page: next, ...(next === 'projects' || next === 'create' ? {} : { projectId: active }) })) return;
    setFormErrors({});
    requestAnimationFrame(() => main.current?.focus());
  }
  function open(p: StudioProject) { if (navigateRoute({ page: 'overview', projectId: p.id })) setFormErrors({}); }
  function update(edit: (p: StudioProject) => void) {
    if (!project) return;
    try { workspace.replaceProjects(workspace.currentProjects().map(p => { if (p.id !== project.id) return p; const next = structuredClone(p); edit(next); next.updatedAt = new Date().toISOString(); return next; })); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The edit exceeds this project’s supported data limits.'); }
  }
  function add(p: StudioProject) {
    try { workspace.replaceProjects(appendProject(workspace.currentProjects(), p)); open(p); return true; }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not add this project.'); return false; }
  }
  function erase(id: string) {
    const result = removeProject(projects, id);
    workspace.replaceProjects(result.projects); setRemoved(result.removed); setDeleteId(undefined);
  }
  function undoDelete() {
    if (!removed) return;
    try { workspace.replaceProjects(restoreProject(projects, removed)); setRemoved(undefined); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not restore the deleted project.'); }
  }
  function downloadDraft() { downloadText('studio-workspace-draft.json', stableStringify({ schemaVersion: 1, projects }), 'application/json'); }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_WORKSPACE_BYTES) throw new Error('Choose a project or workspace JSON smaller than 4 MB.');
      const imported = importProjects(await file.text()).map(p => ({ ...p, id: crypto.randomUUID(), updatedAt: new Date().toISOString(), isExample: false }));
      if (!imported.length) throw new Error('This backup contains no projects.');
      const next = imported.reduce(appendProject, workspace.currentProjects());
      workspace.replaceProjects(next); open(imported[0]); setMessage(`Imported ${imported.length === 1 ? 'a new local project' : `${imported.length} new local projects`}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not import this project.'); }
    if (importInput.current) importInput.current.value = '';
  }
  const navItems: { page: Page; label: string }[] = [{ page: 'overview', label: 'Overview' }, { page: 'mechanic', label: project?.mechanic === 'reveal' ? 'Reveal settings' : 'Items & weights' }, { page: 'payment', label: 'Payment & recovery' }, { page: 'modules', label: 'Optional modules' }, { page: 'files', label: 'Files' }, { page: 'agent', label: 'Agent handoff' }];
  const currentBundle = bundleState && bundleState.source === project ? bundleState.bundle : undefined;
  const inProject = project && page !== 'projects' && page !== 'create';
  return <>
    <a className="skip" href="#main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to workspace</a>
    <header className="app-header"><button className="brand" onClick={() => navigate('projects')} aria-label="D20DAO Studio projects"><BrandMark height={29} /><span>Studio</span></button><nav aria-label="D20DAO resources"><a href="https://d20dao.org/docs" target="_blank" rel="noreferrer">Docs ↗</a><a href="https://d20dao.org/explorer" target="_blank" rel="noreferrer">Explorer ↗</a><a href="https://github.com/d20dao" target="_blank" rel="noreferrer">GitHub ↗</a></nav></header>
    {storageError && <section className="storage-warning workspace-recovery" aria-label="Local workspace recovery" role="alert"><p>{storageError}</p><div className="actions"><button onClick={downloadDraft}>Download local draft</button>{workspace.saved.snapshot !== null && <button onClick={() => downloadText('studio-original-workspace.json', workspace.saved.snapshot!, 'application/json')}>Download original saved data</button>}{workspace.conflict ? <button onClick={() => setConfirmStorage('load')}>Load latest</button> : workspace.recoveryRequired ? <button onClick={() => setConfirmStorage('recover')}>Recover usable projects</button> : <button onClick={workspace.retrySave}>Retry local save</button>}</div>{confirmStorage && <div className="workspace-confirmation"><p>{confirmStorage === 'load' ? 'Load the latest saved workspace? This replaces this tab’s draft. Download the local draft first if you want to keep it.' : `Save these ${projects.length} usable projects as the recovered workspace? The untouched original will be archived in this browser before anything is replaced. Download the original for an independent backup.`}</p><button onClick={() => setConfirmStorage(undefined)}>Keep current draft</button><button className="primary" disabled={workspace.saving} onClick={() => { if (confirmStorage === 'load') { workspace.loadLatest(); setFormErrors({}); setRemoved(undefined); setEditorEpoch(value => value + 1); } else void workspace.recover(); setConfirmStorage(undefined); }}>{confirmStorage === 'load' ? 'Load latest saved projects' : 'Archive original and save recovery'}</button></div>}</section>}
    <div className={`app-shell ${page === 'create' ? 'create-shell' : ''}`}>
      {page !== 'create' && <aside className="sidebar" aria-label="Workspace navigation">{inProject ? <><button className="back-link" onClick={() => navigate('projects')}>← Projects</button><label className="sr-only" htmlFor="project-picker">Current project</label><select id="project-picker" value={active} disabled={blockedDraft} onChange={e => { const selected = projects.find(p => p.id === e.target.value); if (selected) open(selected); }}>{projects.map(p => <option value={p.id} key={p.id}>{p.name || 'Untitled project'}</option>)}</select><p className="nav-label">{project.mechanic === 'lootbox' ? 'Lootbox' : 'NFT reveal'}</p><nav>{navItems.map(item => <button key={item.page} className={item.page === 'files' ? 'file-nav' : ''} aria-current={page === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}>{item.label}</button>)}</nav></> : <><p className="nav-label">Workspace</p><nav><button aria-current="page" onClick={() => navigate('projects')}>Projects</button><button onClick={() => navigate('create')}>New project</button></nav><div className="sidebar-resources"><p className="nav-label">Resources</p><a href="https://d20dao.org/docs/getting-started" target="_blank" rel="noreferrer">Integration guide ↗</a></div></>}</aside>}
      <main id="main" tabIndex={-1} ref={main} className="main-content">
        {page === 'projects' && <><div className="page-heading"><div><p className="eyebrow">Local workspace</p><h1>Your projects</h1><p className="lead">Build a randomness integration from a template.</p></div><div className="actions"><button disabled={!canAdd} onClick={() => importInput.current?.click()}>Import project</button><button disabled={!canAdd} className="primary" onClick={() => navigate('create')}>New project</button></div></div><input type="file" ref={importInput} accept=".json,application/json" className="sr-only" tabIndex={-1} onChange={e => importFile(e.target.files?.[0])} />
          {!canAdd && <p className="notice">This workspace holds {MAX_PROJECTS} projects. Download and remove a project before adding another.</p>}
          {removed && <div className="project-undo" role="status"><span>Deleted “{removed.project.name || 'Untitled project'}”.</span><button onClick={undoDelete}>Undo deletion</button></div>}
          {projects.length ? <div className="table-scroll"><table className="project-table"><thead><tr><th>Project</th><th>Mechanic</th><th>Modified</th><th>Actions</th></tr></thead><tbody>{projects.map(p => <tr key={p.id}><td><button className="project-link" onClick={() => open(p)}>{p.name || 'Untitled project'}</button>{p.isExample && <span className="example-label">Example</span>}</td><td>{p.mechanic === 'lootbox' ? 'Lootbox' : 'NFT reveal'}</td><td>{new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td>{deleteId === p.id ? <div className="workspace-confirmation" role="group" aria-label={`Delete ${p.name || 'Untitled project'}`}><span>Delete this local project?</span><button onClick={() => setDeleteId(undefined)}>Cancel</button><button onClick={() => erase(p.id)}>Delete project</button></div> : <div className="project-row-actions"><button disabled={!canAdd} aria-label={`Duplicate ${p.name || 'Untitled project'}`} onClick={() => add(duplicateProject(p))}>Duplicate</button><button aria-label={`Delete ${p.name || 'Untitled project'}`} onClick={() => setDeleteId(p.id)}>Delete</button><button className="open-project" aria-label={`Open ${p.name || 'Untitled project'}`} onClick={() => open(p)}>→</button></div>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><h2>No local projects yet</h2><p>Create a project or import a saved JSON file to begin.</p><button className="primary" onClick={() => navigate('create')}>Create project</button></div>}
          <p className="local-note">Stored in this browser. Download a project to keep a portable copy.</p><section className="ruled templates"><h2>Start from a template</h2><button onClick={() => { setNewMechanic('lootbox'); navigate('create'); }}><span>Lootbox →</span><small>A weighted reward table for independent draws.</small></button><button onClick={() => { setNewMechanic('reveal'); navigate('create'); }}><span>NFT reveal →</span><small>A fixed token set with reproducible metadata assignment.</small></button></section>
        </>}
        {page === 'create' && <div className="create-project"><button className="back-link" onClick={() => navigate('projects')}>← Projects</button><p className="eyebrow">New project</p><h1>Choose your mechanic</h1><form onSubmit={e => { e.preventDefault(); if (!newName.trim()) return; if (add(createProject(newName.trim(), newMechanic, newTarget))) setNewName(''); }}><Field label="Project name"><input autoFocus required value={newName} maxLength={80} placeholder="Your project name" onChange={e => setNewName(e.target.value)} /></Field><Choices label="Mechanic" value={newMechanic} onChange={setNewMechanic} options={[{ value: 'lootbox', label: 'Lootbox', description: 'Select one reward from a weighted item table.' }, { value: 'reveal', label: 'NFT reveal', description: 'Assign metadata across a fixed token set.' }]} /><section className="ruled"><Choices label="Starting point" value={newTarget} onChange={setNewTarget} options={[{ value: 'new', label: 'New project', description: 'Create a configured consumer starter.' }, { value: 'existing', label: 'Existing project', description: 'Export boilerplate and instructions to integrate in your own repository.' }]} /></section><p className="muted">{newMechanic === 'lootbox' ? 'Starts with ERC-1155 item configuration.' : 'Starts with ERC-721 reveal configuration.'} NFT implementation is completed in your application.</p>{!canAdd && <p className="notice">The {MAX_PROJECTS}-project workspace limit has been reached.</p>}<div className="actions end"><button type="button" onClick={() => navigate('projects')}>Cancel</button><button className="primary" type="submit" disabled={!newName.trim() || !canAdd}>Create local project →</button></div></form></div>}
        {inProject && <><div className="project-heading"><h1>{project.name || 'Untitled project'}</h1><span className="save-state">{project.isExample && 'Example project · '}{blockedDraft ? 'Field edit incomplete' : storageError ? 'In memory only' : workspace.saving ? 'Saving locally…' : 'Saved locally'}</span></div><nav className="tabs" aria-label="Workspace modes"><button aria-current={!['files', 'agent'].includes(page) ? 'page' : undefined} onClick={() => navigate('overview')}>Configure</button><button aria-current={page === 'files' ? 'page' : undefined} onClick={() => navigate('files')}>Code</button><button aria-current={page === 'agent' ? 'page' : undefined} onClick={() => navigate('agent')}>Agent handoff</button></nav>
          {blockedDraft && <p className="notice error" role="status">Finish the highlighted numeric field. Its last valid value is saved; incomplete text is not exported.</p>}
          {!['files', 'agent'].includes(page) && <>{issues.length > 0 && <details className="validation"><summary>{issues.filter(i => i.severity === 'error').length} configuration errors · {issues.filter(i => i.severity === 'warning').length} notes</summary><ul>{issues.map((issue, i) => <li key={i}><span className="mono">{issue.path}</span> — {issue.message}</li>)}</ul></details>}<ConfigEditor key={`${project.id}-${page}-${project.mechanic}-${editorEpoch}`} project={project} page={page as ConfigPage} update={update} navigate={navigate} report={report} /><div className="project-footer"><button className="text-link" disabled={blockedDraft} onClick={() => downloadProject(project)}>Download project JSON</button><span>Starter templates require implementation review.</span></div></>}
          {['files', 'agent'].includes(page) && (generationError ? <div className="notice error" role="alert">{generationError}<button onClick={() => setGenerationAttempt(n => n + 1)}>Retry generation</button></div> : currentBundle ? <FileWorkspace project={project} bundle={currentBundle} agent={page === 'agent'} notify={setMessage} /> : <p className="empty-copy" role="status">Generating files from your configuration…</p>)}
        </>}
      </main>
    </div><footer className="app-footer">Local drafts · D20DAO Studio <span>General-purpose verifiable randomness</span></footer><div className="toast" role="status" aria-live="polite">{message}</div>
  </>;
}
