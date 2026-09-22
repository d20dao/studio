import Prism from 'prismjs';
import 'prismjs/components/prism-solidity';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-typescript';
import type { GeneratedFile } from './types';

export interface CodeSegment { text: string; className: string }

/** Token text remains text. No generated or imported source is rendered as HTML. */
export function highlightLines(content: string, language: GeneratedFile['language']): CodeSegment[][] {
  const lines: CodeSegment[][] = [[]];
  const grammar = Prism.languages[language];
  const stream = grammar && content.length <= 256 * 1024 ? Prism.tokenize(content, grammar) : [content];
  function append(text: string, classes: string[]) {
    text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, className: classes.join(' ') });
    });
  }
  function walk(value: string | Prism.Token | (string | Prism.Token)[], classes: string[] = []) {
    if (typeof value === 'string') { append(value, classes); return; }
    if (Array.isArray(value)) { value.forEach(token => walk(token, classes)); return; }
    const aliases = Array.isArray(value.alias) ? value.alias : value.alias ? [value.alias] : [];
    const names = [value.type, ...aliases].filter(name => /^[a-zA-Z0-9_-]+$/.test(name)).map(name => `syntax-${name}`);
    walk(value.content, [...classes, ...names]);
  }
  walk(stream);
  return lines;
}
