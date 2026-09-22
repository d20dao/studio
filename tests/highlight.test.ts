import { describe, expect, it } from 'vitest';
import { highlightLines } from '../src/core/highlight';

describe('source viewer tokens', () => {
  it('preserves multiline source exactly while providing syntax classes', () => {
    const source = '// two\n/* lines\n of comment */\ncontract Example { string public name = "Hi"; }\n';
    const lines = highlightLines(source, 'solidity');
    expect(lines.map(line => line.map(segment => segment.text).join('')).join('\n')).toBe(source);
    expect(lines.flat().some(segment => segment.className.includes('syntax-keyword'))).toBe(true);
  });
  it('keeps hostile markup as literal text instead of producing HTML', () => {
    const source = '{"name":"<img src=x onerror=alert(1)>"}';
    const lines = highlightLines(source, 'json');
    expect(lines.flat().map(segment => segment.text).join('')).toBe(source);
    expect(lines.flat().every(segment => /^[a-zA-Z0-9_ -]*$/.test(segment.className))).toBe(true);
  });
});
