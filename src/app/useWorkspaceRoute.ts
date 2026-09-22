import { useEffect, useRef, useState } from 'react';
import type { StudioProject } from '../core/types';
import { parseRoute, routeHash, VIEW_KEY } from './workspace-state';
import type { WorkspaceRoute } from './workspace-state';

export function useWorkspaceRoute(projects: StudioProject[], blocked: boolean, notify: (message: string) => void) {
  const [route, setRoute] = useState<WorkspaceRoute>(() => {
    let saved = '';
    try { saved = window.localStorage.getItem(VIEW_KEY) ?? ''; } catch { /* View memory is optional. */ }
    return parseRoute(window.location.hash || saved, projects);
  });
  const routeRef = useRef(route);
  const projectsRef = useRef(projects);
  const blockedRef = useRef(blocked);
  const notifyRef = useRef(notify);
  projectsRef.current = projects;
  blockedRef.current = blocked;
  notifyRef.current = notify;

  function apply(next: WorkspaceRoute, replace = false) {
    routeRef.current = next;
    setRoute(next);
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    try { window.localStorage.setItem(VIEW_KEY, hash); } catch { /* Never poison workspace saving over optional view state. */ }
  }

  useEffect(() => {
    const checked = parseRoute(routeHash(routeRef.current), projects);
    apply(checked, true);
  }, [projects]);

  useEffect(() => {
    function changed() {
      if (blockedRef.current) {
        window.history.replaceState(null, '', routeHash(routeRef.current));
        notifyRef.current('Finish the invalid numeric field before leaving this view.');
        return;
      }
      apply(parseRoute(window.location.hash, projectsRef.current), true);
    }
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed); };
  }, []);

  return {
    route,
    navigate: (next: WorkspaceRoute) => {
      if (blockedRef.current) { notifyRef.current('Finish the invalid numeric field before leaving this view.'); return false; }
      apply(next);
      return true;
    },
  };
}
