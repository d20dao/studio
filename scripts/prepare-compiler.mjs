import { createHash } from 'node:crypto';
import { mkdir, readFile, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const compilerDirectory = path.dirname(require.resolve('solc/package.json'));
const sdkDirectory = path.join(root, 'node_modules', '@d20dao', 'vrf-sdk');
const openzeppelinDirectory = path.join(root, 'node_modules', '@openzeppelin', 'contracts');
const destination = path.join(root, 'public', 'compiler');
const compilerPackage = JSON.parse(await readFile(path.join(compilerDirectory, 'package.json'), 'utf8'));
const sdkPackage = JSON.parse(await readFile(path.join(sdkDirectory, 'package.json'), 'utf8'));
const openzeppelinPackage = JSON.parse(await readFile(path.join(openzeppelinDirectory, 'package.json'), 'utf8'));
if (compilerPackage.version !== '0.8.28' || sdkPackage.version !== '0.4.0' || openzeppelinPackage.version !== '5.6.1') {
  throw new Error('Compiler preparation requires exactly solc 0.8.28, @d20dao/vrf-sdk 0.4.0 and @openzeppelin/contracts 5.6.1. Run npm ci with the reviewed lockfile.');
}
const compilerVersion = require('solc').version();
if (!compilerVersion.startsWith('0.8.28+commit.')) throw new Error('Installed compiler reports an unexpected version.');
const sources = Object.create(null);
const supportedPath = name => /^(?:@d20dao\/vrf-sdk\/contracts\/|@openzeppelin\/contracts\/)[A-Za-z0-9_./-]+\.sol$/.test(name) && !name.split('/').includes('..');
async function collect(logicalPath) {
  if (!supportedPath(logicalPath)) throw new Error('Dependency import is outside the reviewed public packages.');
  if (sources[logicalPath]) return;
  const filename = path.join(root, 'node_modules', ...logicalPath.split('/'));
  const entry = await lstat(filename);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Public dependency sources must be regular files.');
  const content = await readFile(filename, 'utf8');
  sources[logicalPath] = { content };
  for (const match of content.matchAll(/\bimport\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']\s*;/g)) {
    const specifier = match[1];
    const imported = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(logicalPath), specifier)) : specifier;
    await collect(imported);
  }
}
// Only the transitive import closure of the generated templates is bundled.
for (const seed of [
  '@d20dao/vrf-sdk/contracts/D20VRFConsumer.sol',
  '@d20dao/vrf-sdk/contracts/libraries/D20VRFRequests.sol',
  '@openzeppelin/contracts/token/ERC1155/ERC1155.sol',
  '@openzeppelin/contracts/token/ERC721/ERC721.sol',
  '@openzeppelin/contracts/token/common/ERC2981.sol',
  '@openzeppelin/contracts/access/Ownable.sol',
  '@openzeppelin/contracts/utils/ReentrancyGuard.sol',
  '@openzeppelin/contracts/utils/Strings.sol',
]) await collect(seed);
if (!sources['@d20dao/vrf-sdk/contracts/D20VRFConsumer.sol']) throw new Error('The installed SDK is missing its public consumer contract.');
const dependencyBytes = Buffer.from(`${JSON.stringify({ sources }, null, 2)}\n`);
if (Object.keys(sources).length > 256 || dependencyBytes.length > 2 * 1024 * 1024) {
  throw new Error('Public contract dependencies exceed the reviewed compiler limits.');
}
const compilerBytes = await readFile(path.join(compilerDirectory, 'soljson.js'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = {
  schemaVersion: 1,
  compilerPackageVersion: compilerPackage.version,
  compilerVersion,
  sdkVersion: sdkPackage.version,
  openzeppelinVersion: openzeppelinPackage.version,
  compiler: { file: 'soljson.js', sha256: hash(compilerBytes), bytes: compilerBytes.length },
  dependencies: { file: 'dependencies.json', sha256: hash(dependencyBytes), bytes: dependencyBytes.length, sources: Object.keys(sources).length },
};
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, 'soljson.js'), compilerBytes);
await writeFile(path.join(destination, 'dependencies.json'), dependencyBytes);
// Written last: the manifest identifies this complete pair of compiler and dependency assets.
await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared local Solidity ${compilerVersion}; ${Object.keys(sources).length} public sources from SDK ${sdkPackage.version} and OpenZeppelin ${openzeppelinPackage.version}.`);
