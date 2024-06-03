import { CosmoparkRelayerTypes } from '../types';
import { IDockerComposeResult } from 'docker-compose';
export declare class CosmoparkCoordinatorRelayer {
    filename: string;
    private name;
    private relayerType;
    debug: boolean;
    constructor(name: string, type: CosmoparkRelayerTypes, filename: string);
    get type(): CosmoparkRelayerTypes;
    execInNode(command: string): Promise<IDockerComposeResult>;
}
