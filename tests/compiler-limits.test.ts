import { describe, expect, it } from 'vitest';
import { deploymentLimitDiagnostics, MAX_INITCODE_BYTES, MAX_RUNTIME_BYTES } from '../src/compiler/limits';
import type { CompiledContract } from '../src/compiler/types';

const contract = (initcode: number, runtime: number): CompiledContract => ({
  source: 'contracts/Example.sol', name: 'Example', abi: [], bytecode: 'ab'.repeat(initcode), deployedBytecode: 'cd'.repeat(runtime),
});

describe('deployment size limits', () => {
  it('accepts contracts exactly at the EIP-170 and EIP-3860 limits', () => {
    expect(deploymentLimitDiagnostics([contract(MAX_INITCODE_BYTES, MAX_RUNTIME_BYTES)])).toEqual([]);
  });

  it('reports compiled contracts that exceed either limit as undeployable errors', () => {
    const diagnostics = deploymentLimitDiagnostics([contract(MAX_INITCODE_BYTES + 1, MAX_RUNTIME_BYTES + 1)]);
    expect(diagnostics.map(item => item.severity)).toEqual(['error', 'error']);
    expect(diagnostics[0].message).toContain('EIP-170');
    expect(diagnostics[1].message).toContain('49,153 bytes');
    expect(diagnostics.every(item => item.file === 'contracts/Example.sol')).toBe(true);
  });

  it('ignores interfaces and abstract contracts without bytecode', () => {
    expect(deploymentLimitDiagnostics([contract(0, 0)])).toEqual([]);
  });
});
