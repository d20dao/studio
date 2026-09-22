export interface CompilerDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  formattedMessage?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface CompiledContract {
  source: string;
  name: string;
  abi: unknown[];
  /** Solidity's hexadecimal creation bytecode, without a 0x prefix. */
  bytecode: string;
}

export interface CompilationResult {
  compilerVersion: string;
  succeeded: boolean;
  durationMs: number;
  contracts: CompiledContract[];
  diagnostics: CompilerDiagnostic[];
}

export interface CompilerSource {
  content: string;
}

export interface CompilerManifest {
  schemaVersion: 1;
  compilerPackageVersion: '0.8.28';
  compilerVersion: string;
  sdkVersion: '0.4.0';
  openzeppelinVersion: '5.6.1';
  compiler: { file: 'soljson.js'; sha256: string; bytes: number };
  dependencies: { file: 'dependencies.json'; sha256: string; bytes: number; sources: number };
}
