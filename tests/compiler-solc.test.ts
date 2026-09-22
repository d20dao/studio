import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const soljson = require('solc/soljson.js') as {
  cwrap(name: string, returnType: string, args: string[]): (...args: unknown[]) => string;
};
const compile = soljson.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);
const sdk = path.resolve('node_modules/@d20dao/vrf-sdk');
const publicSources = Object.fromEntries([
  'D20VRFConsumer.sol',
  'interfaces/ID20VRF.sol',
  'libraries/RandomnessMapping.sol',
  'libraries/D20VRFRequests.sol',
].map((name) => [`@d20dao/vrf-sdk/contracts/${name}`, { content: readFileSync(path.join(sdk, 'contracts', name), 'utf8') }]));

function run(content: string) {
  // This is the same low-level binding and settings used by the browser worker, with no import callback.
  return JSON.parse(compile(JSON.stringify({
    language: 'Solidity',
    sources: { ...publicSources, 'contracts/Example.sol': { content } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { 'contracts/Example.sol': { '*': ['abi', 'evm.bytecode.object'] } } },
  }), 0, 0));
}

describe('real pinned Solidity compiler', () => {
  it('compiles the installed SDK loot consumer and emits ABI plus bytecode', () => {
    expect(soljson.cwrap('solidity_version', 'string', [])()).toContain('0.8.28+commit.7893614a');
    const output = run(readFileSync(path.join(sdk, 'examples', 'LootDropConsumer.sol'), 'utf8'));
    expect((output.errors ?? []).filter((item: { severity: string }) => item.severity === 'error')).toEqual([]);
    const contract = output.contracts['contracts/Example.sol'].LootDropConsumer;
    expect(contract.abi.some((item: { name?: string }) => item.name === 'open')).toBe(true);
    expect(contract.evm.bytecode.object).toMatch(/^[a-fA-F0-9]{100,}$/);
  });

  it('returns an error for an unresolved remote import instead of fetching it', () => {
    const output = run('// SPDX-License-Identifier: MIT\npragma solidity 0.8.28;\nimport "https://example.invalid/Unreviewed.sol";\ncontract Example {}');
    const errors = output.errors.filter((item: { severity: string }) => item.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('not found');
    expect(output.contracts).toBeUndefined();
  });
});
