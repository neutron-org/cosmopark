import { CosmoparkChain, CosmoparkNetworkConfig, CosmoparkRelayer, CosmoparkWallet } from '../types';
import { IDockerComposeResult } from 'docker-compose';
export declare class CosmoparkIcsChain implements CosmoparkChain {
    type: string;
    network: string;
    config: CosmoparkNetworkConfig;
    relayers: CosmoparkRelayer[];
    filename: string;
    private container;
    debug: boolean;
    constructor(name: string, config: CosmoparkNetworkConfig, filename: string);
    start(wallets: Record<string, CosmoparkWallet>): Promise<void>;
    private execForContainer;
    private prepareTOML;
    private prepareGenesis;
    stop(): Promise<void>;
    restart(): Promise<void>;
    execInNode(command: string): Promise<IDockerComposeResult>;
    startValidator(): Promise<void>;
    stopValidator(): Promise<void>;
    static create(name: string, config: CosmoparkNetworkConfig, wallets: {
        [key: string]: CosmoparkWallet;
    }, filename: string): Promise<CosmoparkIcsChain>;
}
