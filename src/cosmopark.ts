import { CosmoparkChain, CosmoparkConfig } from './types';
import YAML from 'yaml';
import { promises as fs } from 'fs';
import { CosmoparkDefaultChain } from './standardChain';
import dockerCompose from 'docker-compose';

export class Cosmopark {
  config: CosmoparkConfig;
  networks: Record<string, CosmoparkChain> = {};
  constructor(config: CosmoparkConfig) {
    this.config = config;
  }

  static async create(config: CosmoparkConfig): Promise<Cosmopark> {
    const instance = new Cosmopark(config);
    instance.validateConfig(config);
    await instance.generateDockerCompose();
    for (const [key, network] of Object.entries(config.networks)) {
      if (!network.type || network.type === 'default') {
        instance.networks[key] = await CosmoparkDefaultChain.create(
          key,
          network,
          config.wallets,
          config.master_mnemonic,
        );
      }
    }
    // await dockerCompose.upAll({ cwd: process.cwd(), log: true });
    return instance;
  }

  async generateDockerCompose(): Promise<void> {
    const services = {};
    const volumes = {};

    for (const [key, network] of Object.entries(this.config.networks)) {
      const validators = [];
      for (let i = 0; i < network.validators; i++) {
        const name = `${key}_val${i + 1}`;
        validators.push(name);
        services[name] = {
          image: network.image,
          command: ['start', `--home=/opt`],
          volumes: [`${name}:/opt`],
        };
        volumes[name] = null;
      }
    }

    const dockerCompose = {
      version: '3',
      services,
      volumes,
    };

    await fs.writeFile(
      'docker-compose.yml',
      YAML.stringify(dockerCompose, { indent: 2 }),
    );
  }

  validateConfig = (config: CosmoparkConfig) => {
    const networks = new Set(Object.keys(config.networks));
    const relayers = config.relayers || [];

    for (const [key, network] of Object.entries(config.networks)) {
      if (network.type !== 'ics') {
        if (!network.validators_balance) {
          throw new Error(`Network:${key} does not have validators_balance`);
        }
        if (!network.validators) {
          throw new Error(`Network:${key} does not have validators number`);
        }
      }
    }

    for (const relayer of relayers) {
      for (const network of relayer.networks) {
        if (!networks.has(network)) {
          throw new Error(
            `Relayer is linked to the network:${network} is not defined`,
          );
        }
      }
    }
  };
}
