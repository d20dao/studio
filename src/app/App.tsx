import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GeneratedBundle, IntegrationTarget, Mechanic, StudioProject } from '../core/types';
import { createProject, stableStringify, validateProject } from '../core/project';
import { MAX_PROJECTS, MAX_WORKSPACE_BYTES } from '../core/storage';
import { generateProject } from '../core/generate';
import { downloadProject, downloadText } from '../core/export';
import { BrandMark } from '../components/BrandMark';
import { Choices, Field } from '../components/Fields';
import { Modal } from '../components/Modal';
import { ConfigEditor } from './ConfigEditor';
import type { ConfigPage } from './ConfigEditor';
import { FileWorkspace } from './FileWorkspace';
import { appendProject, duplicateProject, importProjects, removeProject, restoreProject } from './workspace-state';
import type { Page, RemovedProject } from './workspace-state';
import { useWorkspace } from './useWorkspace';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import { ProjectActions } from './ProjectActions';
import { draftIssueTarget } from './issue-navigation';
import type { IssueTarget } from './issue-navigation';
import '../styles/projects.css';
import '../styles/studio-intro.css';

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
  const [storageAction, setStorageAction] = useState(false);
  const deleteSelection = useRef<StudioProject | undefined>(undefined);
  const storageIntent = useRef<'load' | 'recover'>('load');
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [bundleState, setBundleState] = useState<{ source: StudioProject; bundle: GeneratedBundle }>();
  const [generationError, setGenerationError] = useState('');
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const [newName, setNewName] = useState('');
  const [newMechanic, setNewMechanic] = useState<Mechanic>('lootbox');
  const [newTarget, setNewTarget] = useState<IntegrationTarget>('new');
  const importInput = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: IssueTarget; projectId: string; fieldKey?: string }>();
  const focusedRequest = useRef<typeof focusRequest>(undefined);
  const project = projects.find(p => p.id === active);
  const canAdd = projects.length < MAX_PROJECTS;
  const issues = project ? validateProject(project) : [];
  useLayoutEffect(() => {
    if (!focusRequest || focusedRequest.current === focusRequest || focusRequest.projectId !== active || focusRequest.target.page !== page || !main.current) return;
    const attribute = focusRequest.fieldKey ? 'data-field-key' : 'data-field-path';
    const key = focusRequest.fieldKey ?? focusRequest.target.path;
    const anchor = [...main.current.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(node => node.getAttribute(attribute) === key);
    if (!anchor) return;
    for (let parent = anchor.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    const control = anchor.matches('input, select, textarea, button') ? anchor : anchor.querySelector<HTMLElement>('input, select, textarea') ?? anchor.querySelector<HTMLElement>('button');
    if (!control) return;
    main.current.querySelectorAll<HTMLElement>('[data-issue-focus]').forEach(node => node.removeAttribute('data-issue-focus'));
    control.dataset.issueFocus = 'true';
    control.focus({ preventScroll: true });
    control.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    focusedRequest.current = focusRequest;
  }, [focusRequest, active, page]);
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
  function goToIssue(target: IssueTarget, fieldKey?: string) {
    if (!project) return;
    if (target.page !== page) {
      if (blockedDraft) {
        const entry = Object.entries(formErrors).find(([, invalid]) => invalid);
        const incomplete = entry && draftIssueTarget(entry[0], project);
        if (entry && incomplete) setFocusRequest({ target: incomplete, fieldKey: entry[0], projectId: project.id });
        setMessage('Finish this incomplete field first. Your edits stay in this section.');
        return;
      }
      if (!navigateRoute({ page: target.page, projectId: project.id })) return;
      setFormErrors({});
    }
    setFocusRequest({ target, fieldKey, projectId: project.id });
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
    try {
      const result = removeProject(workspace.currentProjects(), id);
      workspace.replaceProjects(result.projects); setRemoved(result.removed); setMessage(''); setDeleteId(undefined);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not delete this project.'); setDeleteId(undefined); }
  }
  function undoDelete() {
    if (!removed) return;
    try { workspace.replaceProjects(restoreProject(workspace.currentProjects(), removed)); setRemoved(undefined); setMessage('Project restored.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not restore the deleted project.'); }
  }
  function requestDelete(selected: StudioProject) { deleteSelection.current = selected; setDeleteId(selected.id); }
  function requestStorage(intent: 'load' | 'recover') { storageIntent.current = intent; setConfirmStorage(intent); }
  async function applyStorage() {
    if (!confirmStorage || storageAction || workspace.saving) return;
    setStorageAction(true);
    try {
      if (confirmStorage === 'load') {
        workspace.loadLatest(); setFormErrors({}); setRemoved(undefined); setEditorEpoch(value => value + 1);
      } else await workspace.recover();
      setConfirmStorage(undefined);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Workspace recovery did not complete. Your draft remains available.'); setConfirmStorage(undefined); }
    finally { setStorageAction(false); }
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
    {storageError && <section className="storage-warning workspace-recovery" aria-label="Local workspace recovery" role="alert"><p>{storageError}</p><div className="actions"><button onClick={downloadDraft}>Download local draft</button>{workspace.saved.snapshot !== null && <button onClick={() => downloadText('studio-original-workspace.json', workspace.saved.snapshot!, 'application/json')}>Download original saved data</button>}{workspace.conflict ? <button onClick={() => requestStorage('load')}>Load latest</button> : workspace.recoveryRequired ? <button onClick={() => requestStorage('recover')}>Recover usable projects</button> : <button onClick={workspace.retrySave}>Retry local save</button>}</div></section>}
    <div className={`app-shell ${page === 'create' ? 'create-shell' : ''}`}>
      {page !== 'create' && <aside className="sidebar" aria-label="Workspace navigation">{inProject ? <><button className="back-link" onClick={() => navigate('projects')}>← Projects</button><label className="sr-only" htmlFor="project-picker">Current project</label><select id="project-picker" value={active} disabled={blockedDraft} onChange={e => { const selected = projects.find(p => p.id === e.target.value); if (selected) open(selected); }}>{projects.map(p => <option value={p.id} key={p.id}>{p.name || 'Untitled project'}</option>)}</select><p className="nav-label">{project.mechanic === 'lootbox' ? 'Lootbox' : 'NFT reveal'}</p><nav>{navItems.map(item => <button key={item.page} className={item.page === 'files' ? 'file-nav' : ''} aria-current={page === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}>{item.label}</button>)}</nav></> : <><p className="nav-label">Workspace</p><nav><button aria-current="page" onClick={() => navigate('projects')}>Projects</button><button onClick={() => navigate('create')}>New project</button></nav><div className="sidebar-resources"><p className="nav-label">Resources</p><a href="https://d20dao.org/docs/getting-started" target="_blank" rel="noreferrer">Integration guide ↗</a></div></>}</aside>}
      <main id="main" tabIndex={-1} ref={main} className="main-content" onBlurCapture={event => { if (event.target instanceof HTMLElement) event.target.removeAttribute('data-issue-focus'); }}>
        {page === 'projects' && <><div className="page-heading"><div><p className="eyebrow">Local workspace · Demo</p><h1>Your projects</h1><p className="lead studio-purpose">Prepare NFT contract starters with D20DAO VRF on Arc. Configure ERC-1155 lootboxes, ERC-721 reveals, or an adapter for your existing project.</p></div><div className="actions"><button disabled={!canAdd} onClick={() => importInput.current?.click()}>Import project</button><button disabled={!canAdd} className="primary" onClick={() => navigate('create')}>New project</button></div></div><input type="file" ref={importInput} accept=".json,application/json" className="sr-only" tabIndex={-1} onChange={e => importFile(e.target.files?.[0])} />
          <section className="studio-intro" aria-label="From configuration to your application"><ol><li><span className="studio-step">01 · Configure</span><p>Choose a template and set your collection rules.</p></li><li><span className="studio-step">02 · Export ZIP</span><p>Take the contracts, configuration and <code>AGENTS.md</code>.</p></li><li><span className="studio-step">03 · Continue with your agent</span><p>Open the exported folder. Ask your coding agent to read <code>AGENTS.md</code>, customize the code and complete your app.</p></li></ol><p className="studio-intro-note"><strong>Beta.</strong> This application generates boilerplate tailored to your requirements. Do not use exported code as-is. Ask your agent to customize it, then review and test before deployment.</p></section>
          {!canAdd && <p className="notice">This workspace holds {MAX_PROJECTS} projects. Download and remove a project before adding another.</p>}
          {projects.length ? <div className="table-scroll"><table className="project-table"><thead><tr><th>Project</th><th>Mechanic</th><th>Modified</th><th>Actions</th></tr></thead><tbody>{projects.map(p => <tr key={p.id}><td><button className="project-link" onClick={() => open(p)}>{p.name || 'Untitled project'}</button>{p.isExample && <span className="example-label">Example</span>}</td><td>{p.mechanic === 'lootbox' ? 'Lootbox' : 'NFT reveal'}</td><td>{new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td><div className="project-row-actions"><button disabled={!canAdd} aria-label={`Duplicate ${p.name || 'Untitled project'}`} onClick={() => add(duplicateProject(p))}>Duplicate</button><button aria-label={`Delete ${p.name || 'Untitled project'}`} onClick={() => requestDelete(p)}>Delete</button><button className="open-project" aria-label={`Open ${p.name || 'Untitled project'}`} onClick={() => open(p)}>→</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><h2>No local projects yet</h2><p>Create a project or import a saved JSON file to begin.</p><button className="primary" onClick={() => navigate('create')}>Create project</button></div>}
          <p className="local-note">Stored in this browser. Download a project to keep a portable copy.</p><section className="ruled templates"><h2>Start from a template</h2><button onClick={() => { setNewMechanic('lootbox'); navigate('create'); }}><span>Lootbox →</span><small>ERC-1155 items with independent weighted reward draws.</small></button><button onClick={() => { setNewMechanic('reveal'); navigate('create'); }}><span>NFT reveal →</span><small>ERC-721 reveal batches with shuffle, offset or per-token seeds.</small></button></section>
        </>}
        {page === 'create' && <div className="create-project"><button className="back-link" onClick={() => navigate('projects')}>← Projects</button><p className="eyebrow">New project</p><h1>Choose your mechanic</h1><form onSubmit={e => { e.preventDefault(); if (!newName.trim()) return; if (add(createProject(newName.trim(), newMechanic, newTarget))) setNewName(''); }}><Field label="Project name"><input autoFocus required value={newName} maxLength={80} placeholder="Your project name" onChange={e => setNewName(e.target.value)} /></Field><Choices label="Mechanic" value={newMechanic} onChange={setNewMechanic} options={[{ value: 'lootbox', label: 'Lootbox', description: 'Select one reward from a weighted item table.' }, { value: 'reveal', label: 'NFT reveal', description: 'Reveal minted tokens in batches.' }]} /><section className="ruled"><Choices label="Starting point" value={newTarget} onChange={setNewTarget} options={[{ value: 'new', label: 'New project', description: 'Create a configured consumer starter.' }, { value: 'existing', label: 'Existing project', description: 'Export boilerplate and instructions to integrate in your own repository.' }]} /></section><p className="muted">{newMechanic === 'lootbox' ? 'Starts with ERC-1155 item configuration.' : 'Starts with ERC-721 reveal configuration.'} NFT implementation is completed in your application.</p>{!canAdd && <p className="notice">The {MAX_PROJECTS}-project workspace limit has been reached.</p>}<div className="actions end"><button type="button" onClick={() => navigate('projects')}>Cancel</button><button className="primary" type="submit" disabled={!newName.trim() || !canAdd}>Create local project →</button></div></form></div>}
        {inProject && <><div className="project-heading"><div className="project-title"><h1>{project.name || 'Untitled project'}</h1><span className="save-state">{project.isExample && 'Example project · '}{blockedDraft ? 'Field edit incomplete' : storageError ? 'In memory only' : workspace.saving ? 'Saving locally…' : 'Saved locally'}</span></div><ProjectActions key={project.id} project={project} issues={issues} formErrors={formErrors} bundle={currentBundle} generationError={generationError} onRetry={() => setGenerationAttempt(n => n + 1)} onIssue={goToIssue} /></div><nav className="tabs" aria-label="Workspace modes"><button aria-current={!['files', 'agent'].includes(page) ? 'page' : undefined} onClick={() => navigate('overview')}>Configure</button><button aria-current={page === 'files' ? 'page' : undefined} onClick={() => navigate('files')}>Code</button><button aria-current={page === 'agent' ? 'page' : undefined} onClick={() => navigate('agent')}>Agent handoff</button></nav>
          {!['files', 'agent'].includes(page) && <><ConfigEditor key={`${project.id}-${page}-${project.mechanic}-${editorEpoch}`} project={project} page={page as ConfigPage} update={update} navigate={navigate} report={report} /><div className="project-footer"><button className="text-link" disabled={blockedDraft} onClick={() => downloadProject(project)}>Download project JSON</button><span>Starter templates require implementation review.</span></div></>}
          {['files', 'agent'].includes(page) && (generationError ? <div className="notice error" role="alert">{generationError}<button onClick={() => setGenerationAttempt(n => n + 1)}>Retry generation</button></div> : currentBundle ? <FileWorkspace project={project} bundle={currentBundle} agent={page === 'agent'} notify={setMessage} /> : <p className="empty-copy" role="status">Generating files from your configuration…</p>)}
        </>}
      </main>
    </div><footer className="app-footer">Local drafts · D20DAO Studio <span>General-purpose verifiable randomness</span></footer>
    <Modal open={deleteId !== undefined} onClose={() => setDeleteId(undefined)} title="Delete local project?" footer={<>
      <button type="button" data-modal-initial-focus onClick={() => setDeleteId(undefined)}>Cancel</button>
      <button type="button" className="primary" onClick={() => { if (deleteId) erase(deleteId); }}>Delete project</button>
    </>}>
      <p>Delete “{deleteSelection.current?.name || 'Untitled project'}” from this browser?</p>
      <p className="muted">Downloaded project files stay available. You can undo this deletion from the notification.</p>
    </Modal>
    <Modal open={confirmStorage !== undefined} onClose={() => { if (!storageAction) setConfirmStorage(undefined); }} busy={storageAction} title={storageIntent.current === 'load' ? 'Load latest saved workspace?' : 'Recover usable projects?'} footer={<>
      <button type="button" data-modal-initial-focus disabled={storageAction} onClick={() => setConfirmStorage(undefined)}>Keep current draft</button>
      <button type="button" className="primary" disabled={workspace.saving || storageAction} onClick={() => void applyStorage()}>{storageAction ? 'Saving recovery…' : storageIntent.current === 'load' ? 'Load latest saved projects' : 'Archive original and save recovery'}</button>
    </>}>
      <p>{storageIntent.current === 'load' ? 'This replaces this tab’s draft with the latest saved workspace. Download the local draft first if you want to keep it.' : `Save these ${projects.length} usable projects as the recovered workspace? The untouched original will be archived in this browser before anything is replaced. Download the original for an independent backup.`}</p>
    </Modal>
    <div className={`toast${removed ? ' toast-with-actions' : ''}`} role="status" aria-live="polite">{removed ? <>
      <div className="toast-content"><p>Deleted “{removed.project.name || 'Untitled project'}”.</p>{message && <p>{message}</p>}</div>
      <div className="toast-actions"><button type="button" onClick={undoDelete}>Undo deletion</button><button type="button" className="toast-dismiss" aria-label="Dismiss deletion notification" onClick={() => setRemoved(undefined)}>×</button></div>
    </> : message}</div>
  </>;
}
