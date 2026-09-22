import { useState } from 'react';
import type { GeneratedBundle, StudioProject, ValidationIssue } from '../core/types';
import { downloadBundle } from '../core/export';
import { projectSlug } from '../core/project';
import { Popover } from '../components/Popover';
import { draftIssueTarget, issueTarget } from './issue-navigation';
import type { IssueTarget } from './issue-navigation';
import '../styles/project-actions.css';

type Props = {
  project: StudioProject;
  issues: ValidationIssue[];
  formErrors: Record<string, boolean>;
  bundle?: GeneratedBundle;
  generationError: string;
  onRetry: () => void;
  onIssue: (target: IssueTarget, fieldKey?: string) => void;
};

export function ProjectActions({ project, issues, formErrors, bundle, generationError, onRetry, onIssue }: Props) {
  const [exportError, setExportError] = useState('');
  const [exported, setExported] = useState<{ name: string; kind: GeneratedBundle['kind']; files: number }>();
  const drafts = Object.entries(formErrors).filter(([, invalid]) => invalid).flatMap(([key]) => {
    const target = draftIssueTarget(key, project);
    return target ? [{ key, target }] : [];
  });
  const blocked = Object.values(formErrors).some(Boolean);
  const errors = drafts.length + issues.filter(issue => issue.severity === 'error').length + (generationError ? 1 : 0);
  const notes = issues.filter(issue => issue.severity === 'warning').length;
  const status = errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}${notes ? ` · ${notes} ${notes === 1 ? 'note' : 'notes'}` : ''}` : notes ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : 'No issues';

  function exportZip() {
    setExportError('');
    try {
      if (!bundle || blocked) throw new Error('Finish your field edits and wait for the current files before exporting.');
      downloadBundle(project, bundle);
      setExported({ name: `${projectSlug(project)}.zip`, kind: bundle.kind, files: bundle.files.length });
    } catch (error) {
      setExported(undefined);
      setExportError(error instanceof Error ? error.message : 'Could not create the ZIP. Try again.');
    }
  }

  return <div className="project-actions" aria-label="Project actions">
    <Popover label={`Project issues: ${status}`} trigger={<><span aria-hidden="true">{errors ? '!' : notes ? 'i' : '✓'}</span><span>{status}</span></>} title="Project issues" triggerClassName={`issues-trigger ${errors ? 'has-errors' : notes ? 'has-notes' : ''}`} align="end">
      {close => <>
        <p className="muted">{errors || notes ? 'Select an issue to go to its field.' : 'No configuration issues. Review the generated integration requirements before using the starter.'}</p>
        {blocked && <p className="error">Finish the incomplete field before changing sections or exporting. Your last valid value is preserved.</p>}
        <ul className="project-issues">
          {drafts.map(({ key, target }) => <li key={key}><button className="issue-entry is-error" onClick={() => { close(); onIssue(target, key); }}><span className="issue-label">{target.label}<span className="issue-kind">Incomplete</span></span><span>Finish this field with a valid value.</span></button></li>)}
          {[...issues].sort((a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning')).map((issue, index) => {
            const target = issueTarget(issue.path, project);
            return <li key={`${issue.path}-${index}`}><button className={`issue-entry ${issue.severity === 'error' ? 'is-error' : 'is-note'}`} onClick={() => { close(); onIssue(target); }}><span className="issue-label">{target.label}<span className="issue-kind">{issue.severity === 'error' ? 'Error' : 'Note'}</span></span><span>{issue.message}</span></button></li>;
          })}
          {generationError && <li className="generation-issue"><p className="error">File generation: {generationError}</p><button onClick={onRetry}>Retry generation</button></li>}
        </ul>
      </>}
    </Popover>
    <Popover label={bundle?.kind === 'plan' ? 'Export plan ZIP' : 'Export ZIP'} trigger={blocked ? 'Finish field to export' : !bundle ? 'Preparing export…' : bundle.kind === 'plan' ? 'Export plan ZIP ↓' : 'Export ZIP ↓'} title={exportError ? 'Export failed' : 'ZIP download started'} triggerClassName="primary export-trigger" align="end" disabled={blocked || !bundle} action="show" onTrigger={exportZip}>
      {exportError ? <p role="alert" className="error">{exportError}</p> : exported && <>
        <p role="status"><strong>{exported.name}</strong> · {exported.files} files</p>
        <ol className="export-next-steps"><li>Extract the ZIP into a project folder.</li><li>Open that folder in your editor and point your agent to <code>AGENTS.md</code>.</li><li>Use <code>AGENT_PROMPT.md</code> for the project-specific implementation brief.</li></ol>
        <p className="muted">{exported.kind === 'plan' ? 'This plan preserves your configuration and instructions. Fix the errors and export again to include Solidity.' : 'Includes generated contracts, configuration, pinned dependency declarations, the generation manifest and agent instructions. Your agent installs dependencies and completes the listed integration work.'}</p>
      </>}
    </Popover>
  </div>;
}
