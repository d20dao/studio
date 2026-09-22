import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { NetworkConnection } from 'hardhat/types/network';
import { BrowserProvider, Contract, ContractFactory, id, zeroPadValue, type InterfaceAbi, type JsonRpcSigner, type ContractTransactionResponse } from 'ethers';
import { createProject } from '../src/core/project';
import { generateProject } from '../src/core/generate';
import type { StudioProject } from '../src/core/types';

type Artifact = { abi: InterfaceAbi; evm: { bytecode: { object: string } } };
type Artifacts = Record<string, Artifact>;
const require = createRequire(import.meta.url);
const solc = require('solc') as { compile: (input: string, callbacks: { import: (path: string) => { contents?: string; error?: string } }) => string };
const artifactCache = new Map<string, Artifacts>();
const word = zeroPadValue('0x1234', 32);
const secondWord = zeroPadValue('0xabcd', 32);
const tx = async (pending: Promise<ContractTransactionResponse>) => (await pending).wait();

async function compile(project: StudioProject): Promise<Artifacts> {
  const bundle = await generateProject(project);
  if (bundle.kind !== 'starter') throw new Error(JSON.stringify(bundle.issues));
  const sources = Object.fromEntries(bundle.files.filter(file => file.language === 'solidity').map(file => [file.path, { content: file.content }]));
  sources['tests/evm-fixtures.sol'] = { content: readFileSync(resolve('tests/evm-fixtures.sol'), 'utf8') };
  const key = JSON.stringify(sources);
  const cached = artifactCache.get(key);
  if (cached) return cached;
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  } }), { import: path => /^(?:@d20dao\/vrf-sdk\/contracts\/|@openzeppelin\/contracts\/)[A-Za-z0-9_./-]+\.sol$/.test(path) && !path.split('/').includes('..')
    ? { contents: readFileSync(resolve('node_modules', path), 'utf8') } : { error: 'Unreviewed test import' },
  }));
  const errors = (output.errors ?? []).filter((error: { severity: string }) => error.severity === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));
  const artifacts = Object.assign({}, ...Object.values(output.contracts)) as Artifacts;
  artifactCache.set(key, artifacts);
  return artifacts;
}

describe('generated NFT templates on a local in-process EVM', () => {
  let connection: NetworkConnection;
  let provider: BrowserProvider;
  let owner: JsonRpcSigner;
  let player: JsonRpcSigner;
  let other: JsonRpcSigner;

  beforeEach(async () => {
    const hre = await createHardhatRuntimeEnvironment({ networks: { studio: { type: 'edr-simulated', chainType: 'l1', hardfork: 'cancun' } } });
    connection = await hre.network.create('studio');
    provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
    [owner, player, other] = await Promise.all([provider.getSigner(0), provider.getSigner(1), provider.getSigner(2)]);
  });
  afterEach(async () => { provider?.destroy(); await connection?.close(); });

  function input(mechanic: 'lootbox' | 'reveal'): StudioProject {
    const project = createProject('Relics 雪 "safe"', mechanic);
    project.id = `evm-${mechanic}`;
    project.createdAt = project.updatedAt = '2026-09-22T00:00:00Z';
    project.collection.maxSupply = 4;
    project.collection.metadataBaseUri = 'ipfs://fixed-metadata/';
    project.loot.maxOpenings = 10;
    project.loot.items = [
      { id: 'common', tokenId: '42', name: '雪 "item"', metadataUri: 'ipfs://common-42', weight: 60 },
      { id: 'rare', name: 'Rare', metadataUri: 'ipfs://rare-1', weight: 40 },
    ];
    return project;
  }

  async function deploy(artifacts: Artifacts, name: string, args: unknown[] = []): Promise<Contract> {
    const artifact = artifacts[name];
    const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner).deploy(...args);
    await contract.waitForDeployment();
    return contract as unknown as Contract;
  }

  async function setup(project: StudioProject) {
    const artifacts = await compile(project);
    const coordinator = await deploy(artifacts, 'LifecycleCoordinator');
    const prefix = project.mechanic === 'lootbox' ? 'D20Loot' : 'D20Reveal';
    const collection = await deploy(artifacts, `${prefix}Collection`, [owner.address]);
    const args = [await coordinator.getAddress(), await collection.getAddress(), ...(project.mechanic === 'reveal' ? [owner.address] : [])];
    const consumer = await deploy(artifacts, `${prefix}Starter`, args);
    await tx(collection.setController(await consumer.getAddress()));
    return { artifacts, coordinator, collection, consumer };
  }

  it('implements weighted ERC1155 delivery, fixed token IDs, supply and royalties with out-of-order callbacks', async () => {
    const project = input('lootbox');
    project.modules.premint = { enabled: true, quantity: 2, recipient: owner.address, includeInReveal: true };
    project.modules.royalty = { enabled: true, bps: 750, recipient: other.address };
    const { coordinator, collection, consumer } = await setup(project);
    expect(await collection.name()).toBe(project.collection.name);
    expect(await collection.balanceOf(owner.address, 42)).toBe(2n);
    expect(await collection.uri(42)).toBe('ipfs://common-42');
    expect(await collection.royaltyInfo(42, 10_000)).toEqual([other.address, 750n]);
    expect(await collection.supportsInterface('0x2a55205a')).toBe(true);
    await expect((collection.connect(player) as Contract).setController(player.address)).rejects.toThrow();
    await expect(collection.setController(await coordinator.getAddress())).rejects.toThrow();
    await expect((collection.connect(player) as Contract).reserve(id('unauthorized'), player.address)).rejects.toThrow();
    await expect((consumer.connect(player) as Contract).rawFulfillRandomness(1, word)).rejects.toThrow();
    await expect((consumer.connect(player) as Contract).open(id('underpaid'), { value: 999 })).rejects.toThrow();
    await tx((consumer.connect(player) as Contract).open(id('first'), { value: 1100 }));
    await tx((consumer.connect(other) as Contract).open(id('second'), { value: 1000 }));
    expect(await coordinator.refundCredit(player.address)).toBe(100n);
    expect(await collection.reservedSupply()).toBe(2n);
    await expect(consumer.open(id('full'), { value: 1000 })).rejects.toThrow();
    await tx(coordinator.fulfill(2, secondWord, 0, { gasLimit: 2_000_000 }));
    expect(await coordinator.lastCallbackSucceeded()).toBe(true);
    expect(await coordinator.lastCallbackGas()).toBeLessThan(100_000n);
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    const draw = (await coordinator.getMappedResult(1))[0];
    const tokenId = draw <= 60n ? 42n : 1n;
    expect(await consumer.rewardTokenId(1)).toBe(tokenId);
    await tx(consumer.deliver(1));
    expect(await collection.balanceOf(player.address, tokenId)).toBe(1n);
    await tx(consumer.deliver(2));
    expect(await collection.mintedSupply()).toBe(4n);
    expect(await collection.reservedSupply()).toBe(0n);
    await expect(consumer.deliver(1)).rejects.toThrow();
    await expect((consumer.connect(player) as Contract).open(id('first'), { value: 1000 })).rejects.toThrow();
    await tx(coordinator.rawCallbackForTest(await consumer.getAddress(), 1, secondWord));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    expect((await consumer.openings(1)).word).toBe(word);
    await tx(coordinator.rawCallbackForTest(await consumer.getAddress(), 999, secondWord));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
  }, 30_000);

  it('retries a failed callback with the same accepted word and rolls back rejected NFT delivery', async () => {
    const { artifacts, coordinator, collection, consumer } = await setup(input('lootbox'));
    const receiver = await deploy(artifacts, 'RewardReceiver');
    await tx(receiver.open(await consumer.getAddress(), id('receiver-opening'), { value: 1000 }));
    await tx(coordinator.fulfill(1, word, 1000, { gasLimit: 2_000_000 }));
    expect((await coordinator.requests(1)).accepted).toBe(true);
    expect((await consumer.openings(1)).ready).toBe(false);
    await expect(coordinator.refundRequest(1)).rejects.toThrow();
    await expect(receiver.open(await consumer.getAddress(), id('receiver-opening'), { value: 1000 })).rejects.toThrow();
    await tx(coordinator.retryCallback(1, 100_000, { gasLimit: 2_000_000 }));
    expect((await consumer.openings(1)).word).toBe(word);
    await tx(receiver.setRejectTokens(true));
    await expect(consumer.deliver(1)).rejects.toThrow();
    expect((await consumer.openings(1)).delivered).toBe(false);
    expect(await collection.reservedSupply()).toBe(1n);
    expect(await collection.mintedSupply()).toBe(0n);
    await tx(receiver.setRejectTokens(false));
    await tx(consumer.deliver(1));
    expect((await consumer.openings(1)).delivered).toBe(true);
    expect(await collection.balanceOf(await receiver.getAddress(), await consumer.rewardTokenId(1))).toBe(1n);
    await expect(coordinator.retryCallback(1, 100_000)).rejects.toThrow();
  }, 30_000);

  it('settles an expired refund before notification, releases capacity once and protects a later attempt', async () => {
    const { artifacts, coordinator, collection, consumer } = await setup(input('lootbox'));
    const receiver = await deploy(artifacts, 'RewardReceiver');
    await tx(receiver.setRejectNative(true));
    await tx(receiver.open(await consumer.getAddress(), id('expired'), { value: 1000 }));
    await connection.provider.request({ method: 'evm_increaseTime', params: [61] });
    await connection.provider.request({ method: 'evm_mine', params: [] });
    await tx(coordinator.setDelayNotification(true));
    await tx((coordinator.connect(other) as Contract).refundRequest(1));
    expect((await coordinator.requests(1)).refunded).toBe(true);
    expect(await coordinator.refundCredit(await receiver.getAddress())).toBe(1000n);
    expect(await collection.reservedSupply()).toBe(1n);
    await expect(receiver.open(await consumer.getAddress(), id('expired'), { value: 1000 })).rejects.toThrow();
    await tx(coordinator.retryRefundCallback(1, 1000, { gasLimit: 2_000_000 }));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    expect(await collection.reservedSupply()).toBe(1n);
    expect(await coordinator.refundCredit(await receiver.getAddress())).toBe(1000n);
    await tx(coordinator.retryRefundCallback(1, 100_000, { gasLimit: 2_000_000 }));
    expect(await coordinator.lastCallbackSucceeded()).toBe(true);
    expect(await coordinator.lastCallbackGas()).toBeLessThan(100_000n);
    expect(await collection.reservedSupply()).toBe(0n);
    await tx(receiver.open(await consumer.getAddress(), id('expired'), { value: 1000 }));
    expect(await consumer.admittedActions()).toBe(1n);
    expect(await collection.reservedSupply()).toBe(1n);
    await tx(coordinator.rawRefundForTest(await consumer.getAddress(), 1));
    expect(await collection.reservedSupply()).toBe(1n);
    expect((await consumer.openings(2)).refunded).toBe(false);
    await tx(coordinator.rawCallbackForTest(await consumer.getAddress(), 1, secondWord));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    await tx(coordinator.fulfill(2, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.deliver(2));
    expect(await collection.mintedSupply()).toBe(1n);
  }, 30_000);

  it.each([true, false])('reveals the exact eligible ERC721 set with premint inclusion=%s', async (includeInReveal) => {
    const project = input('reveal');
    project.modules.premint = { enabled: true, quantity: 2, recipient: player.address, includeInReveal };
    project.modules.royalty = { enabled: true, bps: 500, recipient: other.address };
    const { coordinator, collection, consumer } = await setup(project);
    expect(await collection.ownerOf(0)).toBe(player.address);
    expect(await collection.ownerOf(1)).toBe(player.address);
    expect(await collection.royaltyInfo(0, 10_000)).toEqual([other.address, 500n]);
    await expect((consumer.connect(player) as Contract).requestReveal({ value: 1000 })).rejects.toThrow();
    await expect(consumer.requestReveal({ value: 1000 })).rejects.toThrow();
    await expect(collection.closeMint()).rejects.toThrow();
    await expect((collection.connect(player) as Contract).mint(player.address, 1)).rejects.toThrow();
    await tx(collection.mint(owner.address, 2));
    await expect(collection.mint(owner.address, 1)).rejects.toThrow();
    await tx(collection.closeMint());
    await expect(collection.mint(owner.address, 1)).rejects.toThrow();
    expect(await collection.tokenURI(0)).toBe(includeInReveal ? '' : 'ipfs://fixed-metadata/0.json');
    await tx(consumer.requestReveal({ value: 1000 }));
    expect(await consumer.POPULATION()).toBe(includeInReveal ? 4n : 2n);
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    expect(await coordinator.lastCallbackSucceeded()).toBe(true);
    expect(await coordinator.lastCallbackGas()).toBeLessThan(100_000n);
    const assignment = Array.from(await consumer.assignment()) as bigint[];
    const offset = includeInReveal ? 0n : 2n;
    expect(new Set(assignment.map(String)).size).toBe(Number(await consumer.POPULATION()));
    await tx((consumer.connect(other) as Contract).finalizeReveal());
    expect(await collection.revealed()).toBe(true);
    for (let i = 0; i < assignment.length; i++) {
      expect(await collection.tokenURI(offset + BigInt(i))).toBe(`ipfs://fixed-metadata/${offset + assignment[i]}.json`);
    }
    await expect(consumer.finalizeReveal()).rejects.toThrow();
    await expect(consumer.requestReveal({ value: 1000 })).rejects.toThrow();
    await tx(coordinator.rawRefundForTest(await consumer.getAddress(), 1));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    expect(await consumer.ready()).toBe(true);
  }, 30_000);

  it('keeps reveal operator and collection owner explicit through a deployment factory', async () => {
    const project = input('reveal');
    const artifacts = await compile(project);
    const coordinator = await deploy(artifacts, 'LifecycleCoordinator');
    const factory = await deploy(artifacts, 'DeploymentFactory');
    async function throughFactory(name: string, args: unknown[]) {
      const artifact = artifacts[name];
      const data = (await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner).getDeployTransaction(...args)).data;
      const address = await factory.deploy.staticCall(data);
      await tx(factory.deploy(data));
      return new Contract(address, artifact.abi, owner);
    }
    const collection = await throughFactory('D20RevealCollection', [owner.address]);
    expect(await collection.owner()).toBe(owner.address);
    const consumer = await throughFactory('D20RevealStarter', [await coordinator.getAddress(), await collection.getAddress(), player.address]);
    expect(await consumer.operator()).toBe(player.address);
    await tx(collection.setController(await consumer.getAddress()));
    await tx(collection.mint(owner.address, 4));
    await tx(collection.closeMint());
    await expect(consumer.requestReveal({ value: 1000 })).rejects.toThrow();
    await tx((consumer.connect(player) as Contract).requestReveal({ value: 1000 }));
    await connection.provider.request({ method: 'evm_increaseTime', params: [61] });
    await connection.provider.request({ method: 'evm_mine', params: [] });
    await tx(coordinator.refundRequest(1, { gasLimit: 2_000_000 }));
    expect(await consumer.requestId()).toBe(0n);
    await tx((consumer.connect(player) as Contract).requestReveal({ value: 1000 }));
    await tx(coordinator.rawRefundForTest(await consumer.getAddress(), 1));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    expect(await consumer.requestId()).toBe(2n);
    await tx(coordinator.fulfill(2, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.finalizeReveal());
    expect(await collection.revealed()).toBe(true);
  }, 30_000);

  it('also accepts an explicit factory-safe operator for existing-contract reveal adapters', async () => {
    const project = input('reveal');
    project.integration = 'existing';
    const artifacts = await compile(project);
    const coordinator = await deploy(artifacts, 'LifecycleCoordinator');
    const factory = await deploy(artifacts, 'DeploymentFactory');
    const artifact = artifacts.D20RevealStarter;
    const data = (await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner).getDeployTransaction(await coordinator.getAddress(), player.address)).data;
    const address = await factory.deploy.staticCall(data);
    await tx(factory.deploy(data));
    const consumer = new Contract(address, artifact.abi, player);
    expect(await consumer.operator()).toBe(player.address);
    await tx(consumer.requestReveal({ value: 1000 }));
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    expect(await consumer.ready()).toBe(true);
    expect((await consumer.assignment()).length).toBe(4);
  }, 30_000);

  it('keeps the 256-token reveal out of the bounded callback and completes it in a separate transaction', async () => {
    const project = input('reveal');
    project.collection.maxSupply = 256;
    const { coordinator, collection, consumer } = await setup(project);
    for (let batch = 0; batch < 4; batch++) await tx(collection.mint(owner.address, 64));
    await tx(collection.closeMint());
    await tx(consumer.requestReveal({ value: 1000 }));
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    expect(await coordinator.lastCallbackSucceeded()).toBe(true);
    expect(await coordinator.lastCallbackGas()).toBeLessThan(100_000n);
    expect(await collection.revealed()).toBe(false);
    await tx(consumer.finalizeReveal({ gasLimit: 10_000_000 }));
    expect(await collection.revealed()).toBe(true);
    const indexes = await Promise.all(Array.from({ length: 256 }, (_, i) => collection.metadataIndex(i)));
    expect(new Set(indexes.map(String)).size).toBe(256);
    expect(await collection.tokenURI(255)).toBe(`ipfs://fixed-metadata/${indexes[255]}.json`);
  }, 30_000);
});
