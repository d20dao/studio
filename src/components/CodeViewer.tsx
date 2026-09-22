import { useEffect, useMemo, useRef } from 'react';
import { highlightLines } from '../core/highlight';
import type { GeneratedFile } from '../core/types';
import '../styles/code-viewer.css';

export function CodeViewer({ file, focusLine, requestId = 0 }: { file: GeneratedFile; focusLine?: number; requestId?: number }) {
  const host = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => highlightLines(file.content, file.language), [file.content, file.language]);
  useEffect(() => {
    if (!focusLine || !host.current) return;
    const line = host.current.querySelector<HTMLElement>(`[data-source-line="${Math.min(lines.length, Math.max(1, Math.floor(focusLine)))}"]`);
    line?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    line?.focus({ preventScroll: true });
  }, [focusLine, requestId, file.path, lines.length]);
  return <pre ref={host} className={`numbered-source ${file.language === 'markdown' ? 'wrap-source' : ''}`} tabIndex={0} aria-label={`Read-only ${file.path}`}>
    <code>{lines.map((segments, index) => <span key={index} className={`source-line${focusLine === index + 1 ? ' diagnostic-line' : ''}`} data-source-line={index + 1} tabIndex={-1}>
      <span className="line-number" aria-hidden="true">{index + 1}</span><span className="line-content">{segments.length ? segments.map((segment, i) => <span key={i} className={segment.className || undefined}>{segment.text}</span>) : '\u200b'}</span>
    </span>)}</code>
  </pre>;
}
