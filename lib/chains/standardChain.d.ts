import { IDockerComposeResult } from 'docker-compose';
import { Logger } from 'pino';
import { CosmoparkChain, CosmoparkNetworkConfig, CosmoparkRelayer, CosmoparkWallet } from '../types';
export declare class CosmoparkDefaultChain implements CosmoparkChain {
    filename: string;
    type: string;
    network: string;
    config: CosmoparkNetworkConfig;
    relayers: CosmoparkRelayer[];
    private containers;
    logger: Logger;
    commands: {
        init: string;
        keysAdd: string;
        addGenesisAccount: string;
        gentx: string;
        showNodeId: string;
        collectGenTx: string;
    };
    constructor(name: string, config: CosmoparkNetworkConfig, filename: string);
    start(wallets: Record<string, CosmoparkWallet>, mnemonic: string): Promise<void>;
    private execForAllValidatorsContainers;
    private prepareTOML;
    private prepareGenesis;
    stop(): Promise<void>;
    restart(): Promise<void>;
    execInAllValidators(command: (n: number) => string): Promise<{
        res: IDockerComposeResult;
        key: string;
    }[]>;
    execInValidator(validator: string, command: string): Promise<IDockerComposeResult>;
    startValidator(n: number): Promise<void>;
    stopValidator(n: number): Promise<void>;
    static create(name: string, config: CosmoparkNetworkConfig, wallets: {
        [key: string]: CosmoparkWallet;
    }, mnemonic: string, filename: string): Promise<CosmoparkDefaultChain>;
    execInSomewhere(command: string): Promise<IDockerComposeResult>;
}
