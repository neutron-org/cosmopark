import pino from 'pino';
import { CosmoparkChain, CosmoparkConfig, CosmoparkNetworkPortOutput } from './types';
import { CosmoparkHermesRelayer } from './relayers/hermes';
export declare class Cosmopark {
    private context;
    private filename;
    logLevel: pino.Level;
    ports: Record<string, CosmoparkNetworkPortOutput>;
    config: CosmoparkConfig;
    networks: Record<string, CosmoparkChain>;
    relayers: CosmoparkHermesRelayer[];
    constructor(config: CosmoparkConfig);
    static create(config: CosmoparkConfig): Promise<Cosmopark>;
    awaitFirstBlock: () => Promise<void>;
    stop: () => Promise<void>;
    generateDockerCompose(): Promise<void>;
    validateConfig: (config: CosmoparkConfig) => void;
}
