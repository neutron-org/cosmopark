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
    upload?: string[];
    post_init?: string[];
};
export type CosmoparkRelayer = {
    type: CosmoparkRelayerTypes;
    networks: string[];
    connections?: string[][];
    image: string;
    log_level: string;
    binary: string;
    config?: any;
    mnemonic: string;
    balance?: string;
};
export type CosmoparkRelayerTypes = 'hermes' | 'default' | 'neutron';
export type CosmoparkWallet = {
    mnemonic: string;
    balance: string;
};
export type CosmoparkConfig = {
    networks: {
        [key: string]: CosmoparkNetworkConfig;
    };
    relayers?: CosmoparkRelayer[];
    context?: string;
    portOffset?: number;
    master_mnemonic: string;
    wallets?: {
        [key: string]: CosmoparkWallet;
    };
};
export interface CosmoparkChain {
    filename: string;
    type: string;
    network: string;
    config: CosmoparkNetworkConfig;
    relayers: CosmoparkRelayer[];
    start(wallets: Record<string, CosmoparkWallet>, mnemonic: string): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    startValidator(n: number): Promise<void>;
    stopValidator(n: number): Promise<void>;
}
