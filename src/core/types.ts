export type Mechanic = 'lootbox' | 'reveal';
export type IntegrationTarget = 'new' | 'existing';
export type Network = 'arc-testnet' | 'arc-mainnet';
export type Responsibility = 'user' | 'developer' | 'both';

export interface LootItem {
  id: string;
  /** Explicit NFT token identifier. Omission preserves the legacy row-index mapping. */
  tokenId?: string;
  name: string;
  metadataUri: string;
  weight: number;
}

export interface StudioProject {
  schemaVersion: 1;
  id: string;
  name: string;
  mechanic: Mechanic;
  integration: IntegrationTarget;
  network: Network;
  createdAt: string;
  updatedAt: string;
  isExample: boolean;
  collection: {
    name: string;
    symbol: string;
    standard: 'erc721' | 'erc1155';
    maxSupply: number;
    metadataBaseUri: string;
  };
  loot: { items: LootItem[]; maxOpenings: number };
  modules: {
    premint: { enabled: boolean; quantity: number; recipient: string; includeInReveal: boolean };
    royalty: { enabled: boolean; bps: number; recipient: string };
  };
  payment: {
    price: string;
    rngPayer: 'user' | 'developer';
    refundRecipient: 'payer' | 'developer' | 'custom';
    refundAddress: string;
    recovery: Responsibility;
    applicationRefund: 'refund-on-expiry' | 'developer-defined';
  };
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: 'solidity' | 'json' | 'markdown' | 'typescript' | 'text';
}

export interface GeneratedBundle {
  projectId: string;
  fingerprint: string;
  files: GeneratedFile[];
  issues: ValidationIssue[];
  kind: 'starter' | 'plan';
}
