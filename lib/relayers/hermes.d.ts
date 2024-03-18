import { CosmoparkNetworkConfig, CosmoparkRelayer, CosmoparkRelayerTypes } from '../types';
import { IDockerComposeResult } from 'docker-compose';
export declare class CosmoparkHermesRelayer {
    filename: string;
    private name;
    private container;
    private config;
    private networksConfig;
    debug: boolean;
    constructor(name: string, config: CosmoparkRelayer, networksConfig: Record<string, CosmoparkNetworkConfig>, filename: string);
    get type(): CosmoparkRelayerTypes;
    start(): Promise<void>;
    prepareConfig(): any;
    private prepareStarter;
    private execForContainer;
    execInNode(command: string): Promise<IDockerComposeResult>;
    static create(name: string, config: CosmoparkRelayer, networksConfig: Record<string, CosmoparkNetworkConfig>, filename: string): Promise<CosmoparkHermesRelayer>;
}
