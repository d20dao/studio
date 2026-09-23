import type { CompiledContract, CompilerDiagnostic } from './types';

/** EIP-170 runtime code limit. */
export const MAX_RUNTIME_BYTES = 24_576;
/** EIP-3860 creation code limit, before constructor arguments are appended. */
export const MAX_INITCODE_BYTES = 49_152;

export const byteLength = (hex: string) => Math.ceil(hex.length / 2);

/** A contract that compiles can still be impossible to deploy; report it with the compiler output. */
export function deploymentLimitDiagnostics(contracts: CompiledContract[]): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  for (const contract of contracts) {
    const runtime = byteLength(contract.deployedBytecode);
    const initcode = byteLength(contract.bytecode);
    if (runtime > MAX_RUNTIME_BYTES) diagnostics.push({ severity: 'error', file: contract.source, message: `${contract.name} runtime code is ${runtime.toLocaleString('en-US')} bytes. EIP-170 limits deployed contracts to ${MAX_RUNTIME_BYTES.toLocaleString('en-US')} bytes, so it cannot be deployed.` });
    if (initcode > MAX_INITCODE_BYTES) diagnostics.push({ severity: 'error', file: contract.source, message: `${contract.name} creation code is ${initcode.toLocaleString('en-US')} bytes before constructor arguments. EIP-3860 limits creation code to ${MAX_INITCODE_BYTES.toLocaleString('en-US')} bytes, so it cannot be deployed.` });
  }
  return diagnostics;
}
