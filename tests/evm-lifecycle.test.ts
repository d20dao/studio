import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { NetworkConnection } from 'hardhat/types/network';
import { AbiCoder, BrowserProvider, Contract, ContractFactory, id, keccak256, zeroPadValue, ZeroAddress, type InterfaceAbi, type JsonRpcSigner, type ContractTransactionResponse } from 'ethers';
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

async function compile(project: StudioProject, extra: Record<string, string> = {}): Promise<Artifacts> {
  const bundle = await generateProject(project);
  if (bundle.kind !== 'starter') throw new Error(JSON.stringify(bundle.issues));
  const sources = Object.fromEntries(bundle.files.filter(file => file.language === 'solidity').map(file => [file.path, { content: file.content }]));
  sources['tests/evm-fixtures.sol'] = { content: readFileSync(resolve('tests/evm-fixtures.sol'), 'utf8') };
  for (const [path, content] of Object.entries(extra)) sources[path] = { content };
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
    project.reveal.unrevealedUri = 'ipfs://fixed-metadata/unrevealed.json';
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
    expect(await collection.registeredItems()).toBe(await collection.ITEM_COUNT());
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

  it('recovers a permanently rejected NFT only at the requester\'s instruction with the same accepted token and reservation', async () => {
    const project = input('lootbox'); project.collection.maxSupply = 1;
    const { artifacts, coordinator, collection, consumer } = await setup(project);
    const requester = await deploy(artifacts, 'PermanentRejectingRequester');
    const requesterAddress = await requester.getAddress();
    await tx(requester.open(await consumer.getAddress(), id('permanent-receiver'), { value: 1000 }));
    await expect(requester.redirect(await consumer.getAddress(), 1, player.address)).rejects.toThrow();
    await expect((collection.connect(player) as Contract).updateRecipient(id('anything'), player.address)).rejects.toThrow();
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    const before = await consumer.openings(1);
    const tokenId = await consumer.rewardTokenId(1);
    expect(before.requester).toBe(requesterAddress);
    expect(before.deliveryRecipient).toBe(requesterAddress);
    await expect(consumer.deliver(1)).rejects.toThrow();
    await expect((consumer.connect(other) as Contract).setDeliveryRecipient(1, other.address)).rejects.toThrow();
    await expect((requester.connect(other) as Contract).redirect(await consumer.getAddress(), 1, other.address)).rejects.toThrow();
    await expect(requester.redirect(await consumer.getAddress(), 1, ZeroAddress)).rejects.toThrow();
    await expect(coordinator.refundRequest(1)).rejects.toThrow();
    const redirected = await tx(requester.redirect(await consumer.getAddress(), 1, player.address));
    const changed = redirected!.logs.map(log => { try { return consumer.interface.parseLog(log); } catch { return null; } }).find(event => event?.name === 'DeliveryRecipientChanged');
    expect(changed?.args.previousRecipient).toBe(requesterAddress);
    expect(changed?.args.recipient).toBe(player.address);
    const after = await consumer.openings(1);
    expect(after.actionKey).toBe(before.actionKey);
    expect(after.word).toBe(before.word);
    expect(after.requester).toBe(requesterAddress);
    expect(after.deliveryRecipient).toBe(player.address);
    expect(await consumer.rewardTokenId(1)).toBe(tokenId);
    expect((await coordinator.requests(1)).recipient).toBe(requesterAddress);
    expect(await collection.reservedRecipient(before.actionKey)).toBe(player.address);
    expect(await collection.reservedSupply()).toBe(1n);
    expect(await collection.mintedSupply()).toBe(0n);
    const delivered = await tx((consumer.connect(other) as Contract).deliver(1));
    const delivery = delivered!.logs.map(log => { try { return consumer.interface.parseLog(log); } catch { return null; } }).find(event => event?.name === 'RewardDelivered');
    expect(delivery?.args.recipient).toBe(player.address);
    expect(await collection.balanceOf(player.address, tokenId)).toBe(1n);
    expect(await collection.balanceOf(requesterAddress, tokenId)).toBe(0n);
    expect(await collection.reservedSupply()).toBe(0n);
    expect(await collection.mintedSupply()).toBe(1n);
    await expect(requester.redirect(await consumer.getAddress(), 1, other.address)).rejects.toThrow();
    await expect(consumer.deliver(1)).rejects.toThrow();
    await expect(requester.open(await consumer.getAddress(), id('permanent-receiver'), { value: 1000 })).rejects.toThrow();
  }, 30_000);

  it('lets a non-receiving requester choose an NFT beneficiary upfront while keeping refunds with the requester', async () => {
    const { artifacts, coordinator, collection, consumer } = await setup(input('lootbox'));
    const requester = await deploy(artifacts, 'PermanentRejectingRequester');
    await expect(requester.openTo(await consumer.getAddress(), id('zero-recipient'), ZeroAddress, { value: 1000 })).rejects.toThrow();
    expect(await collection.reservedSupply()).toBe(0n);
    expect(await coordinator.nextId()).toBe(1n);
    await tx(requester.openTo(await consumer.getAddress(), id('direct-beneficiary'), player.address, { value: 1100 }));
    expect((await consumer.openings(1)).deliveryRecipient).toBe(player.address);
    expect((await coordinator.requests(1)).recipient).toBe(await requester.getAddress());
    expect(await coordinator.refundCredit(await requester.getAddress())).toBe(100n);
    expect(await coordinator.refundCredit(player.address)).toBe(0n);
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.deliver(1));
    expect(await collection.balanceOf(player.address, await consumer.rewardTokenId(1))).toBe(1n);
  }, 30_000);

  it('blocks recipient redirection and a second mint from inside an ERC1155 receiver hook', async () => {
    const { artifacts, coordinator, collection, consumer } = await setup(input('lootbox'));
    const receiver = await deploy(artifacts, 'ReentrantRewardReceiver');
    await tx(receiver.open(await consumer.getAddress(), id('reentrant-receiver'), other.address, { value: 1000 }));
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.deliver(1));
    expect(await receiver.redirectSucceeded()).toBe(false);
    expect(await receiver.duplicateDeliverySucceeded()).toBe(false);
    expect((await consumer.openings(1)).deliveryRecipient).toBe(await receiver.getAddress());
    const tokenId = await consumer.rewardTokenId(1);
    expect(await collection.balanceOf(await receiver.getAddress(), tokenId)).toBe(1n);
    expect(await collection.balanceOf(other.address, tokenId)).toBe(0n);
    expect(await collection.mintedSupply()).toBe(1n);
    expect(await collection.reservedSupply()).toBe(0n);
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
    expect(await coordinator.nextId()).toBe(3n);
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

  it('admits fresh actions after refunded reservations exceed historical supply, while preserving premint and the mint cap', async () => {
    const project = input('lootbox');
    project.collection.maxSupply = 2;
    project.modules.premint = { enabled: true, quantity: 1, recipient: owner.address, includeInReveal: true };
    const { coordinator, collection, consumer } = await setup(project);
    const playerConsumer = consumer.connect(player) as Contract;
    expect(await collection.mintedSupply()).toBe(1n);
    expect(await collection.balanceOf(owner.address, 42)).toBe(1n);

    // Three distinct actions expire; none mints a reward or consumes permanent capacity.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await tx(playerConsumer.open(id(`fresh-expired-${attempt}`), { value: 1000 }));
      expect(await collection.reservedSupply()).toBe(1n);
      await expect(playerConsumer.open(id(`over-capacity-${attempt}`), { value: 1000 })).rejects.toThrow();
      expect(await coordinator.nextId()).toBe(BigInt(attempt + 1));
      await connection.provider.request({ method: 'evm_increaseTime', params: [61] });
      await connection.provider.request({ method: 'evm_mine', params: [] });
      await tx((coordinator.connect(other) as Contract).refundRequest(attempt, { gasLimit: 2_000_000 }));
      expect((await consumer.openings(attempt)).refunded).toBe(true);
      expect(await collection.reservedSupply()).toBe(0n);
      expect(await collection.mintedSupply()).toBe(1n);
    }
    expect((await coordinator.nextId()) - 1n).toBeGreaterThan(BigInt(project.collection.maxSupply));
    await tx(playerConsumer.open(id('fresh-success-after-refunds'), { value: 1000 }));
    await tx(coordinator.fulfill(4, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.deliver(4));
    expect(await collection.mintedSupply()).toBe(2n);
    expect(await collection.reservedSupply()).toBe(0n);
    expect(await collection.balanceOf(owner.address, 42)).toBe(1n);
    expect(await collection.balanceOf(player.address, await consumer.rewardTokenId(4))).toBe(1n);
    await expect(playerConsumer.open(id('after-mint-cap'), { value: 1000 })).rejects.toThrow();
    expect(await coordinator.nextId()).toBe(5n);
  }, 30_000);

  it('leaves inventory enforcement to the existing-project host while retaining action and accepted-result binding', async () => {
    const project = input('lootbox'); project.integration = 'existing'; project.collection.maxSupply = 1;
    const artifacts = await compile(project);
    const coordinator = await deploy(artifacts, 'LifecycleCoordinator');
    const consumer = await deploy(artifacts, 'D20LootStarter', [await coordinator.getAddress()]);
    const playerConsumer = consumer.connect(player) as Contract;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const action = id(`existing-host-action-${attempt}`);
      await tx(playerConsumer.open(action, { value: 1000 }));
      await tx(coordinator.fulfill(attempt, word, 0, { gasLimit: 2_000_000 }));
      expect((await consumer.openings(attempt)).ready).toBe(true);
      expect((await consumer.openings(attempt)).word).toBe(word);
      await expect(playerConsumer.open(action, { value: 1000 })).rejects.toThrow();
    }
    expect(await coordinator.nextId()).toBe(4n);
  }, 30_000);

  it.each([true, false])('reveals the exact eligible ERC721 set with premint inclusion=%s', async (includeInReveal) => {
    const project = input('reveal');
    project.modules.premint = { enabled: true, quantity: 2, recipient: player.address, includeInReveal };
    project.modules.royalty = { enabled: true, bps: 500, recipient: other.address };
    const { coordinator, collection, consumer } = await setup(project);
    expect(await collection.mintedSupply()).toBe(0n);
    await expect(collection.mint(player.address, 1)).rejects.toThrow();
    await expect(collection.closeMint()).rejects.toThrow();
    await tx(collection.mintPremint(2));
    expect(await collection.ownerOf(0)).toBe(player.address);
    expect(await collection.ownerOf(1)).toBe(player.address);
    await expect(collection.metadataIndex(10)).rejects.toThrow();
    if (includeInReveal) await expect(collection.metadataIndex(1)).rejects.toThrow();
    else expect(await collection.metadataIndex(1)).toBe(1n);
    expect(await collection.royaltyInfo(0, 10_000)).toEqual([other.address, 500n]);
    await expect((consumer.connect(player) as Contract).requestReveal({ value: 1000 })).rejects.toThrow();
    await expect((collection.connect(player) as Contract).mint(player.address, 1)).rejects.toThrow();
    await tx(collection.mint(owner.address, 2));
    await expect(collection.mint(owner.address, 1)).rejects.toThrow();
    await tx(collection.closeMint());
    await expect(collection.mint(owner.address, 1)).rejects.toThrow();
    expect(await collection.tokenURI(0)).toBe(includeInReveal ? 'ipfs://fixed-metadata/unrevealed.json' : 'ipfs://fixed-metadata/0.json');
    expect(await collection.tokenURI(3)).toBe('ipfs://fixed-metadata/unrevealed.json');
    for (const interfaceId of ['0x49064906', '0x80ac58cd', '0x5b5e139f', '0x2a55205a', '0x01ffc9a7']) expect(await collection.supportsInterface(interfaceId)).toBe(true);
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(1)).count).toBe(includeInReveal ? 4n : 2n);
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    expect(await coordinator.lastCallbackSucceeded()).toBe(true);
    expect(await coordinator.lastCallbackGas()).toBeLessThan(100_000n);
    const assignment = Array.from(await consumer.assignment(1)) as bigint[];
    const offset = includeInReveal ? 0n : 2n;
    expect(new Set(assignment.map(String)).size).toBe(includeInReveal ? 4 : 2);
    const finalized = await tx((consumer.connect(other) as Contract).finalizeReveal(1));
    const refresh = finalized!.logs.map(log => { try { return collection.interface.parseLog(log); } catch { return null; } }).find(event => event?.name === 'BatchMetadataUpdate');
    expect([refresh?.args._fromTokenId, refresh?.args._toTokenId]).toEqual([offset, 3n]);
    expect(await collection.nextRevealToken()).toBe(4n);
    for (let i = 0; i < assignment.length; i++) {
      expect(await collection.tokenURI(offset + BigInt(i))).toBe(`ipfs://fixed-metadata/${offset + assignment[i]}.json`);
    }
    await expect(consumer.finalizeReveal(1)).rejects.toThrow();
    await expect(consumer.requestReveal({ value: 1000 })).rejects.toThrow();
    await tx(coordinator.rawRefundForTest(await consumer.getAddress(), 1));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    expect((await consumer.reveals(1)).ready).toBe(true);
  }, 30_000);

  it('keeps reveal operator and collection owner explicit through a deployment factory', async () => {
    const project = input('reveal');
    project.reveal.unrevealedUri = '';
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
    expect(await collection.tokenURI(0)).toBe('');
    await tx(collection.closeMint());
    await expect(consumer.requestReveal({ value: 1000 })).rejects.toThrow();
    await tx((consumer.connect(player) as Contract).requestReveal({ value: 1000 }));
    await connection.provider.request({ method: 'evm_increaseTime', params: [61] });
    await connection.provider.request({ method: 'evm_mine', params: [] });
    await tx(coordinator.refundRequest(1, { gasLimit: 2_000_000 }));
    expect(await consumer.currentRequestId()).toBe(0n);
    await tx((consumer.connect(player) as Contract).requestReveal({ value: 1000 }));
    await tx(coordinator.rawRefundForTest(await consumer.getAddress(), 1));
    expect(await consumer.currentRequestId()).toBe(2n);
    await tx(coordinator.fulfill(2, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.finalizeReveal(2));
    expect(await collection.nextRevealToken()).toBe(4n);
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
    await tx(consumer.requestReveal(id('existing-batch-1'), 4, { value: 1000 }));
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    expect((await consumer.reveals(1)).ready).toBe(true);
    expect((await consumer.assignment(1)).length).toBe(4);
    await expect(consumer.requestReveal(id('existing-batch-1'), 4, { value: 1000 })).rejects.toThrow();
    await tx(consumer.requestReveal(id('existing-batch-2'), 3, { value: 1000 }));
    await connection.provider.request({ method: 'evm_increaseTime', params: [61] });
    await connection.provider.request({ method: 'evm_mine', params: [] });
    await tx(coordinator.refundRequest(2, { gasLimit: 2_000_000 }));
    await expect(consumer.requestReveal(id('existing-batch-2'), 4, { value: 1000 })).rejects.toThrow();
    await tx(consumer.requestReveal(id('existing-batch-2'), 3, { value: 1000 }));
    await tx(coordinator.fulfill(3, secondWord, 0, { gasLimit: 2_000_000 }));
    expect((await consumer.assignment(3)).length).toBe(3);
    expect((await consumer.assignment(1)).length).toBe(4);
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
    expect(await collection.nextRevealToken()).toBe(0n);
    await tx(consumer.finalizeReveal(1, { gasLimit: 10_000_000 }));
    expect(await collection.nextRevealToken()).toBe(256n);
    const indexes = await Promise.all(Array.from({ length: 256 }, (_, i) => collection.metadataIndex(i)));
    expect(new Set(indexes.map(String)).size).toBe(256);
    expect(await collection.tokenURI(255)).toBe(`ipfs://fixed-metadata/${indexes[255]}.json`);
  }, 30_000);

  it('supports an uncapped ERC1155 supply without reintroducing a zero or lifetime request quota', async () => {
    const project = input('lootbox'); project.collection.maxSupply = null;
    project.modules.premint = { enabled: true, quantity: 300, recipient: owner.address, includeInReveal: true };
    const { coordinator, collection, consumer } = await setup(project);
    expect(await collection.SUPPLY_CAPPED()).toBe(false);
    expect(await collection.MAX_SUPPLY()).toBe(0n);
    expect(await collection.mintedSupply()).toBe(300n);
    for (let request = 1; request <= 2; request++) {
      await tx(consumer.open(id(`uncapped-${request}`), { value: 1000 }));
      await tx(coordinator.fulfill(request, word, 0, { gasLimit: 2_000_000 }));
      await tx(consumer.deliver(request));
    }
    expect(await collection.mintedSupply()).toBe(302n);
    expect(await collection.reservedSupply()).toBe(0n);
  }, 30_000);

  it('reveals an uncapped collection across frozen batches while new minting and expired retries preserve each range', async () => {
    const project = input('reveal'); project.collection.maxSupply = null;
    const { coordinator, collection, consumer } = await setup(project);
    expect(await collection.SUPPLY_CAPPED()).toBe(false);
    await tx(collection.mint(owner.address, 10));
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(1)).start).toBe(0n);
    expect((await consumer.reveals(1)).count).toBe(10n);
    await tx(collection.mint(owner.address, 290, { gasLimit: 20_000_000 }));
    expect(await collection.mintedSupply()).toBe(300n);
    expect(await collection.pendingRevealCount()).toBe(10n);
    await expect(consumer.requestReveal({ value: 1000 })).rejects.toThrow();
    await connection.provider.request({ method: 'evm_increaseTime', params: [61] });
    await connection.provider.request({ method: 'evm_mine', params: [] });
    await tx(coordinator.refundRequest(1, { gasLimit: 2_000_000 }));
    expect((await consumer.reveals(1)).refunded).toBe(true);
    expect(await collection.pendingRevealCount()).toBe(10n);
    await tx(collection.mint(owner.address, 5));
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(2)).count).toBe(10n);
    expect((await coordinator.requests(2)).clientSeed).toBe((await coordinator.requests(1)).clientSeed);
    await tx(coordinator.rawRefundForTest(await consumer.getAddress(), 1));
    await tx(coordinator.rawCallbackForTest(await consumer.getAddress(), 1, secondWord));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    expect(await consumer.currentRequestId()).toBe(2n);
    await tx(coordinator.fulfill(2, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.finalizeReveal(2));
    const firstUri = await collection.tokenURI(0);
    expect(firstUri).not.toBe('');
    expect(await collection.tokenURI(10)).toBe('ipfs://fixed-metadata/unrevealed.json');
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(3)).start).toBe(10n);
    expect((await consumer.reveals(3)).count).toBe(256n);
    expect((await coordinator.requests(3)).clientSeed).not.toBe((await coordinator.requests(2)).clientSeed);
    await tx(coordinator.fulfill(3, secondWord, 0, { gasLimit: 2_000_000 }));
    await tx(collection.mint(owner.address, 25));
    expect(await collection.pendingRevealCount()).toBe(256n);
    await tx(consumer.finalizeReveal(3, { gasLimit: 10_000_000 }));
    expect(await collection.nextRevealToken()).toBe(266n);
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(4)).start).toBe(266n);
    expect((await consumer.reveals(4)).count).toBe(64n);
    await tx(coordinator.fulfill(4, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.finalizeReveal(4));
    expect(await collection.nextRevealToken()).toBe(330n);
    expect(await collection.tokenURI(0)).toBe(firstUri);
    expect((await consumer.assignment(2)).length).toBe(10);
    expect(await collection.tokenURI(329)).not.toBe('');
    await expect(consumer.finalizeReveal(2)).rejects.toThrow();
    await tx(coordinator.rawCallbackForTest(await consumer.getAddress(), 2, secondWord));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    await expect(consumer.requestReveal({ value: 1000 })).rejects.toThrow();
  }, 30_000);

  it('stages a large fixed premint and closes below a finite cap without including excluded prefix IDs in reveal', async () => {
    const project = input('reveal'); project.collection.maxSupply = 500;
    project.modules.premint = { enabled: true, quantity: 300, recipient: player.address, includeInReveal: false };
    const { coordinator, collection, consumer } = await setup(project);
    expect(await collection.mintedSupply()).toBe(0n);
    expect(await collection.nextRevealToken()).toBe(300n);
    await tx(collection.mintPremint(120, { gasLimit: 10_000_000 }));
    expect(await collection.premintMinted()).toBe(120n);
    await expect(collection.mint(owner.address, 1)).rejects.toThrow();
    await expect(consumer.requestReveal({ value: 1000 })).rejects.toThrow();
    await expect(collection.closeMint()).rejects.toThrow();
    await tx(collection.mintPremint(180, { gasLimit: 15_000_000 }));
    expect(await collection.balanceOf(player.address)).toBe(300n);
    await expect(collection.mintPremint(1)).rejects.toThrow();
    expect(await collection.tokenURI(0)).toBe('ipfs://fixed-metadata/0.json');
    expect(await collection.tokenURI(299)).toBe('ipfs://fixed-metadata/299.json');
    await tx(collection.mint(owner.address, 5));
    await tx(collection.closeMint());
    expect(await collection.mintedSupply()).toBe(305n);
    await expect(collection.mint(owner.address, 1)).rejects.toThrow();
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(1)).start).toBe(300n);
    expect((await consumer.reveals(1)).count).toBe(5n);
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.finalizeReveal(1));
    const assignment = Array.from(await consumer.assignment(1)) as bigint[];
    for (let i = 0; i < 5; i++) expect(await collection.metadataIndex(300 + i)).toBe(300n + assignment[i]);
    expect(await collection.tokenURI(299)).toBe('ipfs://fixed-metadata/299.json');
  }, 30_000);

  it('blocks mint, close, reveal lock and finalization from an owner/operator NFT receiver hook', async () => {
    const initial = await compile(input('reveal'));
    const hook = await deploy(initial, 'RevealHookOwner');
    const project = input('reveal'); project.collection.maxSupply = null;
    project.modules.premint = { enabled: true, quantity: 2, recipient: await hook.getAddress(), includeInReveal: true };
    const artifacts = await compile(project);
    const coordinator = await deploy(artifacts, 'LifecycleCoordinator');
    const collection = await deploy(artifacts, 'D20RevealCollection', [await hook.getAddress()]);
    const consumer = await deploy(artifacts, 'D20RevealStarter', [await coordinator.getAddress(), await collection.getAddress(), await hook.getAddress()]);
    await tx(hook.configure(await collection.getAddress(), await consumer.getAddress()));
    await tx(hook.fund({ value: 100_000 }));
    await tx(hook.mintPremint(2));
    expect(await collection.mintedSupply()).toBe(2n);
    expect(await hook.closeReentered()).toBe(false);
    expect(await hook.mintReentered()).toBe(false);
    expect(await hook.requestReentered()).toBe(false);
    expect(await coordinator.nextId()).toBe(1n);
    expect(await collection.mintClosed()).toBe(false);
    await tx(hook.request({ value: 1000 }));
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    await tx(hook.setFinalizeAttempt(1));
    await tx(hook.mint(1));
    expect(await hook.finalizeReentered()).toBe(false);
    expect((await consumer.reveals(1)).finalized).toBe(false);
    expect(await collection.pendingRevealCount()).toBe(2n);
    expect(await collection.nextRevealToken()).toBe(0n);
    expect(await collection.mintedSupply()).toBe(3n);
    await tx(consumer.finalizeReveal(1));
    expect(await collection.nextRevealToken()).toBe(2n);
    expect(await collection.tokenURI(2)).toBe('ipfs://fixed-metadata/unrevealed.json');
  }, 30_000);

  it('uses a mapped offset over more than 256 minted tokens and finalizes each rotation in constant storage work', async () => {
    const project = input('reveal'); project.collection.maxSupply = null; project.reveal.mode = 'offset';
    project.modules.premint = { enabled: true, quantity: 2, recipient: player.address, includeInReveal: false };
    const { coordinator, collection, consumer } = await setup(project);
    expect(consumer.interface.hasFunction('assignment')).toBe(false);
    expect(consumer.interface.hasFunction('offset')).toBe(true);
    expect(collection.interface.hasFunction('tokenHash')).toBe(false);
    await tx(collection.mintPremint(2));
    await tx(collection.mint(owner.address, 300, { gasLimit: 20_000_000 }));
    expect(await collection.tokenURI(0)).toBe('ipfs://fixed-metadata/0.json');
    await expect(collection.metadataIndex(2)).rejects.toThrow();
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(1)).count).toBe(300n);
    await tx(collection.mint(owner.address, 25));
    expect(await collection.pendingRevealCount()).toBe(300n);
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    expect(await coordinator.lastCallbackSucceeded()).toBe(true);
    expect(await coordinator.lastCallbackGas()).toBeLessThan(100_000n);
    const offset = await consumer.offset(1);
    expect(offset).toBe((await coordinator.getMappedResult(1))[0]);
    expect(offset).toBeLessThan(300n);
    const receipt = await tx(consumer.finalizeReveal(1, { gasLimit: 1_000_000 }));
    expect(receipt!.gasUsed).toBeLessThan(500_000n);
    expect(await collection.nextRevealToken()).toBe(302n);
    const indices = await Promise.all(Array.from({ length: 300 }, (_, i) => collection.metadataIndex(2 + i)));
    expect(new Set(indices.map(String)).size).toBe(300);
    expect(indices[0]).toBe(2n + offset);
    expect(indices[299]).toBe(2n + ((299n + offset) % 300n));
    expect(await collection.tokenURI(2)).toBe(`ipfs://fixed-metadata/${2n + offset}.json`);
    expect(await collection.tokenURI(302)).toBe('ipfs://fixed-metadata/unrevealed.json');
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(2)).start).toBe(302n);
    expect((await consumer.reveals(2)).count).toBe(25n);
    await tx(coordinator.fulfill(2, secondWord, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.finalizeReveal(2, { gasLimit: 1_000_000 }));
    const secondOffset = await consumer.offset(2);
    expect(await collection.metadataIndex(326)).toBe(302n + ((24n + secondOffset) % 25n));
    expect(await collection.metadataIndex(2)).toBe(indices[0]);
    expect(await collection.metadataIndex(0)).toBe(0n);
    await expect(consumer.finalizeReveal(1)).rejects.toThrow();
  }, 30_000);

  it('derives public per-token hashes from a raw accepted word with frozen retries and keeps identity metadata URLs', async () => {
    const project = input('reveal'); project.collection.maxSupply = 1000; project.reveal.mode = 'token-hash';
    project.modules.premint = { enabled: true, quantity: 2, recipient: player.address, includeInReveal: false };
    const { coordinator, collection, consumer } = await setup(project);
    expect(consumer.interface.hasFunction('assignment')).toBe(false);
    expect(consumer.interface.hasFunction('offset')).toBe(false);
    expect(consumer.interface.hasFunction('resultWord')).toBe(true);
    expect(collection.interface.hasFunction('metadataIndex')).toBe(false);
    await tx(collection.mintPremint(2));
    await tx(collection.mint(owner.address, 300, { gasLimit: 20_000_000 }));
    await expect(collection.tokenHash(0)).rejects.toThrow();
    await expect(collection.tokenHash(2)).rejects.toThrow();
    await tx(consumer.requestReveal({ value: 1000 }));
    await tx(collection.mint(owner.address, 25));
    await connection.provider.request({ method: 'evm_increaseTime', params: [61] });
    await connection.provider.request({ method: 'evm_mine', params: [] });
    await tx(coordinator.refundRequest(1, { gasLimit: 2_000_000 }));
    await tx(consumer.requestReveal({ value: 1000 }));
    expect((await consumer.reveals(2)).count).toBe(300n);
    expect((await coordinator.requests(2)).clientSeed).toBe((await coordinator.requests(1)).clientSeed);
    await tx(coordinator.rawCallbackForTest(await consumer.getAddress(), 1, secondWord));
    expect(await coordinator.lastCallbackSucceeded()).toBe(false);
    await tx(coordinator.fulfill(2, word, 0, { gasLimit: 2_000_000 }));
    expect(await consumer.resultWord(2)).toBe(word);
    expect(await coordinator.lastCallbackGas()).toBeLessThan(100_000n);
    const receipt = await tx(consumer.finalizeReveal(2, { gasLimit: 1_000_000 }));
    expect(receipt!.gasUsed).toBeLessThan(500_000n);
    const expected = keccak256(AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'address', 'bytes32', 'bytes32', 'uint256'],
      [id('D20DAO_STUDIO_TOKEN_HASH_V1'), 31337, await collection.getAddress(), await consumer.CONFIG_DIGEST(), word, 2],
    ));
    expect(await collection.tokenHash(2)).toBe(expected);
    expect(await collection.tokenHash(3)).not.toBe(expected);
    expect(await collection.tokenURI(2)).toBe('ipfs://fixed-metadata/2.json');
    expect(await collection.tokenURI(0)).toBe('ipfs://fixed-metadata/0.json');
    expect(await collection.tokenURI(302)).toBe('ipfs://fixed-metadata/unrevealed.json');
    await expect(collection.tokenHash(0)).rejects.toThrow();
    await expect(collection.tokenHash(302)).rejects.toThrow();
    await tx(consumer.requestReveal({ value: 1000 }));
    await tx(coordinator.fulfill(3, secondWord, 0, { gasLimit: 2_000_000 }));
    await tx(consumer.finalizeReveal(3, { gasLimit: 1_000_000 }));
    expect(await collection.tokenHash(2)).toBe(expected);
    const lastExpected = keccak256(AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'address', 'bytes32', 'bytes32', 'uint256'],
      [id('D20DAO_STUDIO_TOKEN_HASH_V1'), 31337, await collection.getAddress(), await consumer.CONFIG_DIGEST(), secondWord, 326],
    ));
    expect(await collection.tokenHash(326)).toBe(lastExpected);
    expect(await collection.tokenURI(326)).toBe('ipfs://fixed-metadata/326.json');
  }, 30_000);

  it('deploys a 256-item loot table within limits, registers the rest only with valid proofs and walks packed weights', async () => {
    const project = input('lootbox');
    project.collection.maxSupply = null;
    project.loot.items = Array.from({ length: 256 }, (_, index) => ({
      id: `item-${index}`, name: `Item ${index}`, weight: index % 4 === 1 ? 0 : index + 1,
      metadataUri: `ipfs://bafy-metadata-reference-${index}/item.json`.padEnd(73, 'x'),
    }));
    const bundle = await generateProject(project);
    const registration = JSON.parse(bundle.files.find(file => file.path === 'config/item-registration.json')!.content) as {
      storedAtDeployment: number; pending: { index: number; tokenId: string; uri: string; proof: string[] }[];
    };
    const artifacts = await compile(project);
    const initcode = artifacts.D20LootCollection.evm.bytecode.object.length / 2;
    expect(initcode).toBeLessThan(49_152);
    const coordinator = await deploy(artifacts, 'LifecycleCoordinator');
    const collectionFactory = new ContractFactory(artifacts.D20LootCollection.abi, artifacts.D20LootCollection.evm.bytecode.object, owner);
    const collection = await collectionFactory.deploy(owner.address) as unknown as Contract;
    const deployed = await collection.deploymentTransaction()!.wait();
    expect(deployed!.gasUsed).toBeLessThan(10_000_000n);
    const consumer = await deploy(artifacts, 'D20LootStarter', [await coordinator.getAddress(), await collection.getAddress()]);
    await tx(collection.setController(await consumer.getAddress()));
    expect(await collection.registeredItems()).toBe(BigInt(registration.storedAtDeployment));
    await expect(consumer.open(id('before-registration'), { value: 1000 })).rejects.toThrow();

    const [first, second] = registration.pending;
    await expect(collection.registerItems([{ ...first, uri: `${first.uri}-tampered` }])).rejects.toThrow();
    await expect(collection.registerItems([{ ...first, tokenId: '999999' }])).rejects.toThrow();
    await expect(collection.registerItems([{ ...first, proof: second.proof }])).rejects.toThrow();
    await expect(collection.registerItems([{ ...first, proof: first.proof.slice(1) }])).rejects.toThrow();
    const registrar = collection.connect(other) as Contract;
    for (let start = 0; start < registration.pending.length; start += 64) {
      await tx(registrar.registerItems(registration.pending.slice(start, start + 64), { gasLimit: 29_000_000 }));
    }
    expect(await collection.registeredItems()).toBe(256n);
    await tx(registrar.registerItems([first], { gasLimit: 1_000_000 }));
    expect(await collection.registeredItems()).toBe(256n);
    expect(await collection.uri(255)).toBe(project.loot.items[255].metadataUri);
    expect(await collection.uri(first.index)).toBe(first.uri);

    const cumulative: bigint[] = [];
    project.loot.items.reduce((total, item) => { cumulative.push(total + BigInt(item.weight)); return total + BigInt(item.weight); }, 0n);
    const words = [word, secondWord, zeroPadValue('0x01', 32), keccak256('0x1234'), keccak256('0xfeed')];
    for (const [index, value] of words.entries()) {
      await tx(consumer.open(id(`large-table-${index}`), { value: 1000 }));
      await tx(coordinator.fulfill(index + 1, value, 0, { gasLimit: 2_000_000 }));
      const draw = (await coordinator.getMappedResult(index + 1))[0] as bigint;
      const expected = cumulative.findIndex(total => total >= draw);
      expect(project.loot.items[expected].weight).toBeGreaterThan(0);
      expect(await consumer.rewardIndex(index + 1)).toBe(BigInt(expected));
      expect(await consumer.rewardTokenId(index + 1)).toBe(BigInt(expected));
      const receipt = await tx(consumer.deliver(index + 1));
      expect(receipt!.gasUsed).toBeLessThan(250_000n);
      expect(await collection.balanceOf(owner.address, expected)).toBeGreaterThan(0n);
    }
  }, 120_000);

  it('lets an integration gate openings by overriding _authorizeOpen without changing delivery or refunds', async () => {
    const gated = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {D20LootStarter} from "contracts/D20LootStarter.sol";
contract GatedLootStarter is D20LootStarter {
    address public immutable game;
    error NotEntitled();
    constructor(address coordinator, address collection_, address game_) D20LootStarter(coordinator, collection_) { game = game_; }
    function _authorizeOpen(address requester, bytes32, address) internal view override { if (requester != game) revert NotEntitled(); }
}
`;
    const project = input('lootbox');
    const artifacts = await compile(project, { 'tests/GatedLootStarter.sol': gated });
    const coordinator = await deploy(artifacts, 'LifecycleCoordinator');
    const collection = await deploy(artifacts, 'D20LootCollection', [owner.address]);
    const consumer = await deploy(artifacts, 'GatedLootStarter', [await coordinator.getAddress(), await collection.getAddress(), player.address]);
    await tx(collection.setController(await consumer.getAddress()));
    await expect((consumer.connect(other) as Contract).open(id('not-entitled'), { value: 1000 })).rejects.toThrow();
    expect(await coordinator.nextId()).toBe(1n);
    expect(await collection.reservedSupply()).toBe(0n);
    await tx((consumer.connect(player) as Contract).openTo(id('entitled'), other.address, { value: 1000 }));
    await tx(coordinator.fulfill(1, word, 0, { gasLimit: 2_000_000 }));
    await tx((consumer.connect(other) as Contract).deliver(1));
    expect(await collection.balanceOf(other.address, await consumer.rewardTokenId(1))).toBe(1n);
    expect((await coordinator.requests(1)).recipient).toBe(player.address);
  }, 30_000);
});
