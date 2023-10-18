import { CosmoparkNetworkConfig, CosmoparkRelayer } from '../types';
import { IDockerComposeResult } from 'docker-compose';
import { Relayer } from './relayers';
export declare class CosmoparkHermesRelayer implements Relayer {
    filename: string;
    private name;
    private container;
    private config;
    private networksConfig;
    debug: boolean;
    constructor(name: string, config: CosmoparkRelayer, networksConfig: Record<string, CosmoparkNetworkConfig>, filename: string);
    type(): string;
    start(): Promise<void>;
    pause(): Promise<void>;
    unpause(): Promise<void>;
    prepareConfig(): any;
    private prepareStarter;
    private execForContainer;
    execInNode(command: string): Promise<IDockerComposeResult>;
    private dockerComposeOptions;
    static create(name: string, config: CosmoparkRelayer, networksConfig: Record<string, CosmoparkNetworkConfig>, filename: string): Promise<CosmoparkHermesRelayer>;
}
