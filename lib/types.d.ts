import { IDockerComposeResult } from 'docker-compose';
import { Logger } from 'pino';
export type CosmoparkNetworkTypes = 'ics' | 'default';
export type CosmoparkNetworkPortType = 'rpc' | 'grpc' | 'rest';
export type CosmoparkNetworkPortOutput = Record<CosmoparkNetworkPortType, number>;
export type CosmoparkNetworkConfig = {
    image: string;
    denom: string;
    binary: string;
    chain_id: string;
    prefix: string;
    validators?: number;
    type?: CosmoparkNetworkTypes;
    validators_balance?: string[] | string;
    validators_stake?: string[] | string;
    loglevel?: string;
    trace?: boolean;
    public?: boolean;
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
    post_start?: string[];
    commands?: Record<string, string>;
};
export type CosmoparkRelayer = {
    type: CosmoparkRelayerTypes;
    networks: string[];
    connections?: string[][];
    environment?: Record<string, string>;
    image: string;
    log_level: string;
    binary: string;
    config?: any;
    mnemonic: string;
    balance?: string;
    upload?: string[];
    post_init?: string[];
};
export type CosmoparkRelayerTypes = 'hermes' | 'default' | 'neutron' | 'coordinator';
export type CosmoparkWallet = {
    mnemonic: string;
    balance: string;
};
export type CosmoparkConfig = {
    networks: {
        [key: string]: CosmoparkNetworkConfig;
    };
    loglevel?: string;
    relayers?: CosmoparkRelayer[];
    context?: string;
    portOffset?: number;
    master_mnemonic: string;
    awaitFirstBlock?: boolean;
    wallets?: {
        [key: string]: CosmoparkWallet;
    };
    custom_containers?: CosmoparkCustomContainer[];
};
export type CosmoparkCustomContainer = {
    name: string;
    image: string;
    entrypoint: string;
    ports: string[];
    depends_on: string[];
    volumes: string[];
};
export interface CosmoparkChain {
    execInSomewhere(command: string): Promise<IDockerComposeResult>;
    filename: string;
    type: string;
    network: string;
    config: CosmoparkNetworkConfig;
    relayers: CosmoparkRelayer[];
    logger: Logger;
    start(wallets: Record<string, CosmoparkWallet>, mnemonic: string): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    startValidator(n: number): Promise<void>;
    stopValidator(n: number): Promise<void>;
    commands?: Record<string, string>;
}
