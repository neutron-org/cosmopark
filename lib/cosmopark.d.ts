import { CosmoparkChain, CosmoparkConfig, CosmoparkNetworkPortOutput } from './types';
import { Relayer } from './relayers/relayers';
export declare class Cosmopark {
    private debug;
    private context;
    private filename;
    ports: Record<string, CosmoparkNetworkPortOutput>;
    config: CosmoparkConfig;
    networks: Record<string, CosmoparkChain>;
    relayers: Relayer[];
    constructor(config: CosmoparkConfig);
    static create(config: CosmoparkConfig): Promise<Cosmopark>;
    awaitFirstBlock: () => Promise<void>;
    stop: () => Promise<void>;
    generateDockerCompose(): Promise<void>;
    validateConfig: (config: CosmoparkConfig) => void;
}
