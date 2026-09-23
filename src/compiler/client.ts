import type { GeneratedFile } from '../core/types';
import { collectSources, COMPILER_PACKAGE_VERSION } from './input';
import { deploymentLimitDiagnostics } from './limits';
import type { CompilationResult } from './types';

export type { CompilationResult, CompiledContract, CompilerDiagnostic } from './types';

const TIMEOUT_MS = 120_000;

/** Actual local Solidity compilation. Cancellation rejects with AbortError; failures return diagnostics. */
export async function compileFiles(
  files: GeneratedFile[],
  options: { signal?: AbortSignal } = {},
): Promise<CompilationResult> {
  const started = performance.now();
  const failure = (message: string): CompilationResult => ({
    compilerVersion: COMPILER_PACKAGE_VERSION,
    succeeded: false,
    deployable: false,
    durationMs: Math.round(performance.now() - started),
    contracts: [],
    diagnostics: [{ severity: 'error', message }],
  });
  if (options.signal?.aborted) throw new DOMException('Compilation cancelled.', 'AbortError');
  let sources;
  try {
    sources = collectSources(files);
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'Invalid compiler input.');
  }
  if (typeof Worker === 'undefined') return failure('This browser does not support local compiler workers.');

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(`${import.meta.env.BASE_URL}compiler/worker.js`, { name: 'd20-studio-solidity' });
    } catch {
      resolve(failure('The local compiler worker could not start. Check browser worker permissions.'));
      return;
    }
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const finish = (result: CompilationResult) => {
      if (finished) return;
      finished = true;
      cleanup();
      const limits = result.succeeded ? deploymentLimitDiagnostics(result.contracts) : [];
      resolve({ ...result, deployable: result.succeeded && limits.length === 0, diagnostics: [...result.diagnostics, ...limits], durationMs: Math.round(performance.now() - started) });
    };
    const onAbort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new DOMException('Compilation cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      finish(failure('Compilation exceeded the two-minute limit. The compiler worker was stopped.'));
    }, TIMEOUT_MS);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    // Covers cancellation between the initial check and listener registration.
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    worker.onmessage = (event: MessageEvent<CompilationResult>) => {
      const result = event.data;
      if (!result || typeof result.succeeded !== 'boolean' || !Array.isArray(result.diagnostics) || !Array.isArray(result.contracts) ||
        result.contracts.some(contract => typeof contract?.bytecode !== 'string' || typeof contract.deployedBytecode !== 'string')) {
        finish(failure('The compiler returned an invalid response.'));
        return;
      }
      finish(result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(failure('The compiler worker failed. Reload the page or rebuild the local compiler assets.'));
    };
    worker.onmessageerror = () => finish(failure('The compiler worker response could not be read.'));
    try {
      worker.postMessage({ type: 'compile', sources });
    } catch {
      finish(failure('The project could not be sent to the local compiler worker.'));
    }
  });
}
