export type CosmoparkNetworkTypes = 'ics' | 'default';

export type CosmoparkNetworkConfig = {
  image: string;
  denom: string;
  binary: string;
  chain_id: string;
  prefix: string;
  validators?: number;
  type?: CosmoparkNetworkTypes;
  validators_balance?: string[] | string;
  genesis_opts?: {
    [key: string]: any;
  };
  config_opts?: {
    [key: string]: any;
  };
  app_opts?: {
    [key: string]: any;
  };
};

export type CosmoparkRelayer = {
  type: CosmoparkRelayerTypes;
  networks: string[];
  config?: any;
};

export type CosmoparkRelayerTypes = 'hermes' | 'default';

export type CosmoparkWallet = {
  mnemonic: string;
  balance: string;
};

export type CosmoparkConfig = {
  networks: {
    [key: string]: CosmoparkNetworkConfig;
  };
  relayers?: CosmoparkRelayer[];
  master_mnemonic: string;
  wallets?: {
    [key: string]: CosmoparkWallet;
  };
};

export interface CosmoparkChain {
  type: string;
  network: string;
  config: CosmoparkNetworkConfig;
  relayers: CosmoparkRelayer[];
  start(
    wallets: Record<string, CosmoparkWallet>,
    mnemonic: string,
  ): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  startValidator(n: number): Promise<void>;
  stopValidator(n: number): Promise<void>;
}
