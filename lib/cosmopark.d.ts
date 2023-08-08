import { CosmoparkChain, CosmoparkConfig } from './types';
export declare class Cosmopark {
    private debug;
    private context;
    private filename;
    config: CosmoparkConfig;
    networks: Record<string, CosmoparkChain>;
    relayers: any[];
    constructor(config: CosmoparkConfig);
    static create(config: CosmoparkConfig): Promise<Cosmopark>;
    generateDockerCompose(): Promise<void>;
    validateConfig: (config: CosmoparkConfig) => void;
}
