import { useEffect, useRef, useState } from 'react';
import type { GeneratedBundle, GeneratedFile, StudioProject } from '../core/types';
import { downloadGeneratedFile, downloadProject, downloadText } from '../core/export';
import { compileFiles } from '../compiler/client';
import { byteLength, MAX_INITCODE_BYTES, MAX_RUNTIME_BYTES } from '../compiler/limits';
import type { CompilationResult, CompiledContract, CompilerDiagnostic } from '../compiler/types';
import { CodeViewer } from '../components/CodeViewer';

type Props = { project: StudioProject; bundle: GeneratedBundle; agent: boolean; notify: (message: string) => void };
export function FileWorkspace({ project, bundle, agent, notify }: Props) {
  const [selected, setSelected] = useState('');
  const [agentMode, setAgentMode] = useState<'prompt' | 'agents' | 'contents'>('prompt');
  const [output, setOutput] = useState<'problems' | 'abi' | 'bytecode'>('problems');
  const [result, setResult] = useState<{ fingerprint: string; value: CompilationResult }>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [jump, setJump] = useState<{ file: string; line: number; requestId: number }>();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { abort.current?.abort(); setBusy(false); setJump(undefined); return () => abort.current?.abort(); }, [bundle.fingerprint]);
  const current = bundle.files.find(file => file.path === selected) ?? bundle.files.find(file => file.language === 'solidity') ?? bundle.files[0];
  const prompt = bundle.files.find(file => /agent.prompt/i.test(file.path));
  const agents = bundle.files.find(file => file.path.endsWith('AGENTS.md'));
  const fresh = result?.fingerprint === bundle.fingerprint;
  async function copy(file: GeneratedFile) {
    try { await navigator.clipboard.writeText(file.content); notify(`Copied ${file.path}.`); }
    catch { notify('Clipboard unavailable. Download the file instead.'); }
  }
  async function compile() {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    setBusy(true); setFailure(''); setResult(undefined);
    try { const value = await compileFiles(bundle.files, { signal: controller.signal }); if (!controller.signal.aborted) setResult({ fingerprint: bundle.fingerprint, value }); }
    catch (error) { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'Compilation failed. Try again.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function cancelCompile() {
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    notify('Compilation cancelled. No new artifacts were produced.');
  }
  function downloadArtifact(contract: CompiledContract, kind: 'abi' | 'bytecode') {
    if (busy || !fresh || !result?.value.succeeded) return;
    const name = contract.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'contract';
    if (kind === 'abi') downloadText(`${name}.abi.json`, `${JSON.stringify(contract.abi, null, 2)}\n`, 'application/json');
    else if (contract.bytecode) downloadText(`${name}.bytecode.txt`, `${contract.bytecode}\n`);
  }
  function showDiagnostic(item: CompilerDiagnostic, index: number) {
    const navigable = !!item.file && !!item.line && bundle.files.some(file => file.path === item.file);
    return <div className="diagnostic-entry" key={index}>
      {navigable ? <button className="diagnostic-location" onClick={() => {
        setSelected(item.file!);
        setJump(previous => ({ file: item.file!, line: item.line!, requestId: (previous?.requestId ?? 0) + 1 }));
      }}>{item.file}:{item.line}{item.column ? ':' + item.column : ''}</button> : item.file && <small>{item.file} · dependency source</small>}
      <pre className={item.severity === 'error' ? 'error' : 'muted'}>{item.formattedMessage ?? item.message}</pre>
    </div>;
  }
  let implemented: string[] = [], integration: string[] = [];
  try {
    const manifest = JSON.parse(bundle.files.find(file => file.path === 'GENERATION-MANIFEST.json')?.content ?? '{}');
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
    implemented = strings(manifest.implementedFeatures); integration = strings(manifest.integrationRequired);
  } catch { /* An unavailable coverage report never implies implementation. */ }
  const groups = new Map<string, GeneratedFile[]>();
  for (const file of bundle.files) { const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''; groups.set(folder, [...(groups.get(folder) ?? []), file]); }
  const code = (file: GeneratedFile) => <div className="source-pane"><div className="source-toolbar"><span title={file.path}>{file.path}</span><div><button onClick={() => copy(file)}>Copy</button><button onClick={() => downloadGeneratedFile(file)}>Download</button></div></div><CodeViewer file={file} focusLine={jump?.file === file.path ? jump.line : undefined} requestId={jump?.requestId} /></div>;
  return <>
    <div className="workspace-heading"><div><h2>{agent ? 'Continue in your project' : 'Project files'}</h2><p className="muted">{agent ? 'Take the configured starter and implementation brief into your editor.' : `${bundle.kind === 'plan' ? 'Integration plan' : project.integration === 'new' && implemented.length ? 'Collection + VRF starter' : 'Consumer starter'} · Review and test before deployment.`}</p></div></div>
    {(implemented.length > 0 || integration.length > 0) && <details className="validation"><summary>Template scope and remaining integration</summary>{implemented.length > 0 && <><h3>Included in the generated contracts</h3><ul>{implemented.map(item => <li key={item}>{item}</li>)}</ul></>}{integration.length > 0 && <><h3>Complete in your application</h3><ul>{integration.map(item => <li key={item}>{item}</li>)}</ul></>}</details>}
    {agent ? <div className="agent-layout"><div><nav className="tabs" aria-label="Handoff views">{(['prompt', 'agents', 'contents'] as const).map(mode => <button key={mode} aria-current={agentMode === mode ? 'page' : undefined} onClick={() => setAgentMode(mode)}>{mode === 'prompt' ? 'Agent prompt' : mode === 'agents' ? 'AGENTS.md' : 'Export contents'}</button>)}</nav>{agentMode === 'contents' ? <ul className="export-list">{bundle.files.map(file => <li key={file.path}><span>{file.path}</span><button onClick={() => downloadGeneratedFile(file)}>Download</button></li>)}</ul> : (agentMode === 'prompt' ? prompt : agents) ? code((agentMode === 'prompt' ? prompt : agents)!) : <p className="notice">This bundle does not contain that file.</p>}</div><aside className="summary-rail"><h3>Project bundle</h3>{[...groups.keys()].map(group => group && <p key={group}>{group}/</p>)}<p>Configuration + instructions</p><button onClick={() => downloadProject(project)}>Download project JSON</button><hr /><p className="muted">Existing project? Use these files as boilerplate. Your repository is not edited automatically.</p></aside></div> : <div className="file-layout"><aside className="file-tree" aria-label="Generated files"><h3>Files <span className="muted">({bundle.files.length})</span></h3>{[...groups].map(([folder, files]) => folder ? <details key={folder} open><summary>{folder}/</summary>{files.map(file => <button className={current?.path === file.path ? 'selected' : ''} key={file.path} onClick={() => { setSelected(file.path); setJump(undefined); }} title={file.path}>{file.path.slice(folder.length + 1)}</button>)}</details> : files.map(file => <button className={current?.path === file.path ? 'selected' : ''} key={file.path} onClick={() => { setSelected(file.path); setJump(undefined); }}>{file.path}</button>))}</aside><div className="editor-column">{current ? code(current) : <p>No generated files.</p>}<section className="compiler"><div className="compiler-toolbar"><h3>Browser compiler</h3><div><button disabled={busy || !bundle.files.some(file => file.language === 'solidity')} onClick={compile}>{busy ? 'Compiling…' : 'Compile'}</button>{busy && <button onClick={cancelCompile}>Cancel</button>}<span role="status">{busy ? 'Working locally' : result && !fresh ? 'Source changed · recompile' : fresh ? result!.value.succeeded ? result!.value.deployable ? 'Compiled' : 'Compiled · exceeds deploy size limit' : 'Compiler errors' : 'Not compiled'}</span></div></div><nav className="tabs" aria-label="Compiler output">{(['problems', 'abi', 'bytecode'] as const).map(tab => <button key={tab} aria-current={output === tab ? 'page' : undefined} onClick={() => setOutput(tab)}>{tab === 'abi' ? 'ABI' : tab === 'bytecode' ? 'Bytecode' : 'Problems'}</button>)}</nav><div className="compiler-output">{failure && <p className="error" role="alert">{failure}</p>}{!fresh ? <p className="empty-copy">{result ? 'Source changed. Compile the current files to inspect matching artifacts.' : 'Compile to inspect diagnostics and artifacts.'}</p> : output === 'problems' ? <><p className="muted">Solidity {result!.value.compilerVersion} · {Math.round(result!.value.durationMs)} ms</p>{result!.value.diagnostics.length ? result!.value.diagnostics.map(showDiagnostic) : <p>No compiler diagnostics. Compilation does not establish deployment readiness or an audit.</p>}</> : result!.value.contracts.length ? result!.value.contracts.map((contract, i) => <details key={`${contract.source}-${contract.name}-${i}`} open={i === 0}><summary>{contract.name} · {contract.source}</summary>{output === 'bytecode' && contract.bytecode && <p className="muted">Creation {byteLength(contract.bytecode).toLocaleString('en-US')} / {MAX_INITCODE_BYTES.toLocaleString('en-US')} bytes · runtime {byteLength(contract.deployedBytecode).toLocaleString('en-US')} / {MAX_RUNTIME_BYTES.toLocaleString('en-US')} bytes</p>}{fresh && result!.value.succeeded && !busy && <div className="artifact-actions"><button onClick={() => downloadArtifact(contract, 'abi')}>Download ABI</button><button disabled={!contract.bytecode} onClick={() => downloadArtifact(contract, 'bytecode')}>Download bytecode</button></div>}<pre tabIndex={0}>{output === 'abi' ? JSON.stringify(contract.abi, null, 2) : contract.bytecode || 'No deployable bytecode for this contract.'}</pre></details>) : <p>No artifacts were produced.</p>}</div></section></div></div>}
  </>;
}
