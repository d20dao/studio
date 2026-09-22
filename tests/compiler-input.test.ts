import { describe, expect, it } from 'vitest';
import type { GeneratedFile } from '../src/core/types';
import { collectSources, MAX_SOURCE_BYTES } from '../src/compiler/input';

const file = (path: string, content = 'pragma solidity 0.8.28; contract Example {}'): GeneratedFile => ({ path, content, language: 'solidity' });

describe('compiler input boundary', () => {
  it('selects Solidity text without accepting metadata as an import or instruction', () => {
    const sources = collectSources([file('contracts/Example.sol'), { path: 'README.md', content: 'import https://example.invalid', language: 'markdown' }]);
    expect(Object.keys(sources)).toEqual(['contracts/Example.sol']);
  });

  it.each(['../escape.sol', '/absolute.sol', 'contracts/../../escape.sol', 'https://example.invalid/Remote.sol', '@d20dao/vrf-sdk/contracts/D20VRFConsumer.sol', 'node_modules/a.sol', 'contracts\\Windows.sol'])('rejects an unsafe or dependency-owned path: %s', (path) => {
    expect(() => collectSources([file(path)])).toThrow();
  });

  it('rejects duplicate files rather than silently replacing an input', () => {
    expect(() => collectSources([file('A.sol'), file('A.sol')])).toThrow('Duplicate');
  });

  it('counts actual UTF-8 bytes for its bounded input', () => {
    expect(() => collectSources([file('A.sol', 'é'.repeat(MAX_SOURCE_BYTES / 2 + 1))])).toThrow('256 KiB');
  });

  it('does not report a plan with no source as a successful compilation', () => {
    expect(() => collectSources([{ path: 'README.md', content: 'Plan only', language: 'markdown' }])).toThrow('no Solidity');
  });
});
