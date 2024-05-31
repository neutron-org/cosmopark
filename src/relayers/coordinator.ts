import { CosmoparkRelayerTypes } from '../types';
import dockerCompose, { IDockerComposeResult } from 'docker-compose';

import _ from 'lodash';

export class CosmoparkCoordinatorRelayer {
  filename: string;
  private name: string;
  private relayerType: CosmoparkRelayerTypes;

  debug = false;
  constructor(name: string, type: CosmoparkRelayerTypes, filename: string) {
    this.name = name;
    this.relayerType = type;
    this.filename = filename;
  }

  get type(): CosmoparkRelayerTypes {
    return this.relayerType;
  }

  execInNode(command: string): Promise<IDockerComposeResult> {
    return dockerCompose.exec(this.name, [`sh`, `-c`, command], {
      config: this.filename,
      log: this.debug,
    });
  }
}
