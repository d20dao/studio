/* Classic worker: pinned compiler and public SDK/OZ sources are prepared by scripts/prepare-compiler.mjs. */
'use strict';

const MAX_COMPILER_BYTES = 16 * 1024 * 1024;
const MAX_DEPENDENCY_BYTES = 2 * 1024 * 1024;
let active = false;

async function readAsset(name, limit) {
  // Asset names are fixed here, never taken from source imports, metadata or manifest URLs.
  const response = await fetch(new URL(name, self.location.href), { cache: 'no-cache', credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error(`Local compiler asset ${name} is unavailable (HTTP ${response.status}). Run npm run prepare:compiler.`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error(`Local compiler asset ${name} exceeds its size limit.`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function verify(bytes, entry, name) {
  if (!entry || entry.bytes !== bytes.byteLength || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error(`Local compiler asset ${name} does not match its manifest.`);
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
  if (actual !== entry.sha256) throw new Error(`Local compiler asset ${name} failed its integrity check. Rebuild the compiler assets.`);
}

function diagnostic(error, sources) {
  const result = {
    severity: ['error', 'warning', 'info'].includes(error.severity) ? error.severity : 'error',
    message: typeof error.message === 'string' ? error.message : 'Unknown Solidity diagnostic.',
  };
  if (typeof error.formattedMessage === 'string') result.formattedMessage = error.formattedMessage;
  const location = error.sourceLocation;
  if (location && typeof location.file === 'string') {
    result.file = location.file;
    const content = sources[location.file]?.content;
    if (typeof content === 'string' && Number.isInteger(location.start) && location.start >= 0) {
      // Solidity offsets count UTF-8 bytes, while JavaScript string offsets count UTF-16 code units.
      const prefix = new TextDecoder().decode(new TextEncoder().encode(content).subarray(0, location.start));
      const lines = prefix.split('\n');
      result.line = lines.length;
      result.column = Array.from(lines[lines.length - 1]).length + 1;
    }
  }
  return result;
}

self.onmessage = async (event) => {
  if (active) return;
  active = true;
  const start = performance.now();
  let version = '0.8.28';
  try {
    const requested = event.data?.sources;
    if (event.data?.type !== 'compile' || !requested || typeof requested !== 'object') throw new Error('Invalid compiler request.');
    const names = Object.keys(requested);
    let sourceBytes = 0;
    if (!names.length || names.length > 100) throw new Error('Compilation requires between 1 and 100 Solidity source files.');
    for (const name of names) {
      if (name.length > 240 || !/^[A-Za-z0-9_.\/-]+\.sol$/.test(name) || name.split('/').some((part) => !part || part === '.' || part === '..') || name.startsWith('node_modules/')) {
        throw new Error('Invalid Solidity source path.');
      }
      if (typeof requested[name]?.content !== 'string') throw new Error('Invalid Solidity source content.');
      const size = new TextEncoder().encode(requested[name].content).byteLength;
      if (size > 256 * 1024) throw new Error('A Solidity source exceeds 256 KiB.');
      sourceBytes += size;
    }
    if (sourceBytes > 2 * 1024 * 1024) throw new Error('Solidity source text exceeds 2 MiB.');
    const manifest = JSON.parse(new TextDecoder().decode(await readAsset('manifest.json', 16 * 1024)));
    if (manifest.schemaVersion !== 1 || manifest.compilerPackageVersion !== '0.8.28' || manifest.sdkVersion !== '0.4.0' || manifest.openzeppelinVersion !== '5.6.1' || typeof manifest.compilerVersion !== 'string' || !manifest.compilerVersion.startsWith('0.8.28+commit.')) {
      throw new Error('Local compiler manifest does not identify the reviewed Solidity/SDK versions.');
    }
    const [compilerBytes, dependencyBytes] = await Promise.all([
      readAsset('soljson.js', MAX_COMPILER_BYTES),
      readAsset('dependencies.json', MAX_DEPENDENCY_BYTES),
    ]);
    await Promise.all([verify(compilerBytes, manifest.compiler, 'soljson.js'), verify(dependencyBytes, manifest.dependencies, 'dependencies.json')]);
    const dependencies = JSON.parse(new TextDecoder().decode(dependencyBytes)).sources;
    if (!dependencies || typeof dependencies !== 'object' || Object.keys(dependencies).length !== manifest.dependencies.sources || Object.keys(dependencies).length > 256) {
      throw new Error('Invalid local SDK dependency bundle.');
    }
    for (const [name, source] of Object.entries(dependencies)) {
      if ((!name.startsWith('@d20dao/vrf-sdk/contracts/') && !name.startsWith('@openzeppelin/contracts/')) || !name.endsWith('.sol') || name.includes('..') || typeof source?.content !== 'string') {
        throw new Error('Unexpected source in the local SDK dependency bundle.');
      }
    }
    // Execute exactly the bytes whose hash was checked, without a second network read.
    const compilerUrl = URL.createObjectURL(new Blob([compilerBytes], { type: 'application/javascript' }));
    try { importScripts(compilerUrl); } finally { URL.revokeObjectURL(compilerUrl); }
    const module = self.Module;
    if (!module || typeof module.cwrap !== 'function') throw new Error('The Solidity compiler did not initialize.');
    version = module.cwrap('solidity_version', 'string', [])();
    if (version !== manifest.compilerVersion) throw new Error('Loaded Solidity version differs from the prepared manifest.');
    const sources = { ...dependencies, ...requested };
    const outputSelection = Object.fromEntries(names.map((name) => [name, { '*': ['abi', 'evm.bytecode.object'] }]));
    const input = {
      language: 'Solidity',
      sources,
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection },
    };
    // Every import is supplied in sources. Null callback pointers prevent external import resolution.
    const compile = module.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);
    const output = JSON.parse(compile(JSON.stringify(input), 0, 0));
    const diagnostics = (output.errors || []).map((error) => diagnostic(error, sources));
    const succeeded = !diagnostics.some((entry) => entry.severity === 'error');
    const contracts = [];
    if (succeeded) {
      for (const source of names.sort()) {
        for (const [name, contract] of Object.entries(output.contracts?.[source] || {}).sort(([a], [b]) => a.localeCompare(b))) {
          contracts.push({ source, name, abi: contract.abi || [], bytecode: contract.evm?.bytecode?.object || '' });
        }
      }
    }
    self.postMessage({ compilerVersion: version, succeeded, durationMs: Math.round(performance.now() - start), contracts, diagnostics });
  } catch (error) {
    self.postMessage({ compilerVersion: version, succeeded: false, durationMs: Math.round(performance.now() - start), contracts: [], diagnostics: [{ severity: 'error', message: error instanceof Error ? error.message : 'Local compilation failed.' }] });
  }
};
