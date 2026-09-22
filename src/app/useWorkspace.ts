import { useEffect, useRef, useState } from 'react';
import { createExampleProjects } from '../core/project';
import { loadWorkspace, saveBrowserWorkspace, validateWorkspaceDraft, WORKSPACE_KEY } from '../core/storage';
import type { LoadedWorkspace, SaveResult } from '../core/storage';
import type { StudioProject } from '../core/types';

export function useWorkspace(incompleteField: boolean) {
  const [initial] = useState(loadWorkspace);
  const [projects, setProjects] = useState(() => initial.exists ? initial.projects : createExampleProjects());
  const [saved, setSaved] = useState<LoadedWorkspace>(initial);
  const [error, setError] = useState(initial.error ?? '');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = useRef(projects);
  const persisted = useRef<StudioProject[] | null>(initial.exists ? initial.projects : null);
  const snapshot = useRef(initial.snapshot);
  const protectedData = useRef(Boolean(initial.error));
  const conflictRef = useRef(false);
  const session = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const incomplete = useRef(incompleteField);
  const savingRef = useRef(false);
  incomplete.current = incompleteField;

  function replaceProjects(next: StudioProject[]) {
    validateWorkspaceDraft(next);
    current.current = next;
    setProjects(next);
  }

  function acceptLoaded(loaded: LoadedWorkspace) {
    session.current++;
    snapshot.current = loaded.snapshot;
    protectedData.current = Boolean(loaded.error);
    conflictRef.current = false;
    persisted.current = loaded.projects;
    current.current = loaded.projects;
    setProjects(loaded.projects);
    setSaved(loaded);
    setConflict(false);
    setError(loaded.error ?? '');
  }

  function handleResult(result: SaveResult, written: StudioProject[]) {
    if (result.ok) {
      snapshot.current = result.snapshot;
      persisted.current = written;
      protectedData.current = false;
      setSaved({ projects: written, exists: true, snapshot: result.snapshot, revision: result.revision, rejectedProjects: 0 });
      setError('');
    } else if (result.reason !== 'cancelled') {
      setError(result.error);
      if (result.reason === 'conflict') {
        conflictRef.current = true;
        setConflict(true);
        setSaved(loadWorkspace());
      }
    }
  }

  useEffect(() => {
    const written = projects;
    const generation = session.current;
    if (protectedData.current || conflictRef.current || persisted.current === written) return;
    let active = true;
    queue.current = queue.current.then(async () => {
      if (!active || generation !== session.current || current.current !== written || conflictRef.current || protectedData.current) return;
      savingRef.current = true;
      setSaving(true);
      const result = await saveBrowserWorkspace(written, { expectedSnapshot: snapshot.current }, {
        isCurrent: () => active && generation === session.current && current.current === written && !conflictRef.current,
      });
      // The transaction can already have committed when React cleans this
      // effect. Advance its token even if a newer local draft is now waiting.
      if (generation === session.current) handleResult(result, written);
      savingRef.current = false;
      setSaving(false);
    });
    return () => { active = false; };
  }, [projects, attempt]);

  useEffect(() => {
    function changed(event: StorageEvent) {
      if (event.key !== WORKSPACE_KEY && event.key !== null) return;
      const latest = loadWorkspace();
      if (latest.snapshot === snapshot.current) return;
      if (!incomplete.current && !savingRef.current && !protectedData.current && !conflictRef.current && current.current === persisted.current) {
        acceptLoaded(latest);
      } else {
        session.current++;
        conflictRef.current = true;
        setSaved(latest);
        setConflict(true);
        setError('Another tab changed the saved workspace. Your local draft is kept here. Download it before loading the latest projects.');
      }
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (current.current !== persisted.current || incomplete.current) { event.preventDefault(); event.returnValue = ''; }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  async function recover() {
    if (conflictRef.current) return;
    const written = current.current;
    const generation = session.current;
    setSaving(true);
    savingRef.current = true;
    const result = await saveBrowserWorkspace(written, { expectedSnapshot: snapshot.current, recover: true }, {
      isCurrent: () => generation === session.current && current.current === written && !conflictRef.current,
    });
    if (generation === session.current) handleResult(result, written);
    savingRef.current = false;
    setSaving(false);
    setAttempt(value => value + 1);
  }

  return {
    projects, replaceProjects, saved, error, conflict, saving,
    currentProjects: () => current.current,
    recoveryRequired: Boolean(saved.error) && !conflict,
    loadLatest: () => acceptLoaded(loadWorkspace()),
    recover,
    retrySave: () => setAttempt(value => value + 1),
  };
}
