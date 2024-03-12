import { IDockerComposeResult } from 'docker-compose';
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
    query_relayer: CosmoparkHermesRelayer | null;
    constructor(config: CosmoparkConfig);
    static create(config: CosmoparkConfig): Promise<Cosmopark>;
    awaitFirstBlock: () => Promise<void>;
    pauseRelayer(type: 'hermes' | 'neutron', index: number): Promise<void>;
    resumeRelayer(type: 'hermes' | 'neutron', index: number): Promise<void>;
    restartRelayer(type: 'hermes' | 'neutron', index: number): Promise<void>;
    pauseNetwork(network: string): Promise<void>;
    executeInNetwork: (network: string, command: string) => Promise<IDockerComposeResult>;
    executeInQueryRelayer: (command: string) => Promise<IDockerComposeResult>;
    stop: () => Promise<void>;
    generateDockerCompose: () => void;
    validateConfig: (config: CosmoparkConfig) => void;
}
