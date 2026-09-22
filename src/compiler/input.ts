import type { GeneratedFile } from '../core/types';
import type { CompilerSource } from './types';

export const COMPILER_PACKAGE_VERSION = '0.8.28';
export const SDK_PACKAGE_VERSION = '0.4.0';
export const OPENZEPPELIN_PACKAGE_VERSION = '5.6.1';
export const MAX_SOURCE_FILES = 100;
export const MAX_SOURCE_BYTES = 256 * 1024;
export const MAX_TOTAL_SOURCE_BYTES = 2 * 1024 * 1024;

/** Only caller-owned Solidity sources enter the compiler; imports never fetch arbitrary URLs. */
export function collectSources(files: GeneratedFile[]): Record<string, CompilerSource> {
  if (!Array.isArray(files) || files.length > 500) {
    throw new Error('The compiler accepts a project bundle with at most 500 files.');
  }
  const sources: Record<string, CompilerSource> = Object.create(null);
  const encoder = new TextEncoder();
  let bytes = 0;
  let count = 0;
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new Error('Every project file must have a path and text content.');
    }
    if (!file.path.endsWith('.sol')) continue;
    const parts = file.path.split('/');
    if (
      file.path.length > 240 ||
      !/^[A-Za-z0-9_.\/-]+\.sol$/.test(file.path) ||
      parts.some((part) => !part || part === '.' || part === '..') ||
      parts[0] === 'node_modules'
    ) {
      throw new Error(`Unsupported Solidity source path: ${file.path.slice(0, 240)}`);
    }
    if (Object.hasOwn(sources, file.path)) throw new Error(`Duplicate Solidity source: ${file.path}`);
    const size = encoder.encode(file.content).byteLength;
    if (size > MAX_SOURCE_BYTES) throw new Error(`${file.path} exceeds the 256 KiB source limit.`);
    bytes += size;
    count += 1;
    if (bytes > MAX_TOTAL_SOURCE_BYTES || count > MAX_SOURCE_FILES) {
      throw new Error('Compilation is limited to 100 Solidity files and 2 MiB of source text.');
    }
    sources[file.path] = { content: file.content };
  }
  if (!count) throw new Error('This bundle contains no Solidity files to compile.');
  return sources;
}
