import { CosmoparkChain, CosmoparkConfig, CosmoparkWallet } from './types';
import YAML from 'yaml';
import { promises as fs } from 'fs';
import { CosmoparkDefaultChain } from './chains/standardChain';
import dockerCompose from 'docker-compose';
import { CosmoparkIcsChain } from './chains/icsChain';
import { CosmoparkHermesRelayer } from './relayers/hermes';
import { dockerCommand } from 'docker-cli-js';

export class Cosmopark {
  config: CosmoparkConfig;
  networks: Record<string, CosmoparkChain> = {};
  relayers: any[] = []; //TODO: add relayers type
  constructor(config: CosmoparkConfig) {
    this.config = config;
  }

  static async create(config: CosmoparkConfig): Promise<Cosmopark> {
    const instance = new Cosmopark(config);
    instance.validateConfig(config);
    try {
      await dockerCompose.down({
        cwd: process.cwd(),
        log: false,
        commandOptions: ['-v', '--remove-orphans'],
      });
    } catch (e) {
      const res = await dockerCompose.ps({ commandOptions: ['-a'] });
      if (res.exitCode === 0) {
        const containers = res.out
          .split('\n')
          .filter((v) => v.match(/cosmopark_/))
          .map((v) => v.split(' ')[0]);
        await dockerCommand(`stop -t0 ${containers.join(' ')}`);
        await dockerCompose.down({
          cwd: process.cwd(),
          log: false,
          commandOptions: ['-v', '--remove-orphans'],
        });
      } else {
        throw e;
      }
    }
    await instance.generateDockerCompose();
    const relayerWallets: Record<string, CosmoparkWallet> =
      config.relayers
        ?.map((relayer) => ({
          mnemonic: relayer.mnemonic,
          balance: relayer.balance,
        }))
        .reduce((a, c, idx) => ({ ...a, [`relayer-${idx}`]: c }), {}) || {};
    for (const [key, network] of Object.entries(config.networks)) {
      switch (network.type) {
        case 'ics':
          instance.networks[key] = await CosmoparkIcsChain.create(
            key,
            network,
            { ...config.wallets, ...relayerWallets },
          );
          break;
        default:
          instance.networks[key] = await CosmoparkDefaultChain.create(
            key,
            network,
            { ...config.wallets, ...relayerWallets },
            config.master_mnemonic,
          );
          break;
      }
    }
    for (const [index, relayer] of Object.entries(config.relayers || [])) {
      switch (relayer.type) {
        case 'hermes':
          instance.relayers.push(
            await CosmoparkHermesRelayer.create(
              `relayer_${relayer.type}${index}`,
              relayer,
              config.networks,
            ),
          );
          break;
        default:
          throw new Error(`Relayer type ${relayer.type} is not supported`);
      }
    }
    await dockerCompose.upAll({ cwd: process.cwd(), log: true });
    return instance;
  }

  async generateDockerCompose(): Promise<void> {
    const services = {};
    const volumes = {};
    let networkCounter = 0;
    for (const [key, network] of Object.entries(this.config.networks)) {
      switch (network.type) {
        case 'ics':
          {
            const name = `${key}_ics`;
            services[name] = {
              image: network.image,
              command: ['start', `--home=/opt`],
              entrypoint: [network.binary],
              volumes: [`${name}:/opt`],
              ports: [
                `127.0.0.1:${networkCounter + 26657}:26657`,
                `127.0.0.1:${networkCounter + 1317}:1317`,
                `127.0.0.1:${networkCounter + 9090}:9090`,
              ],
            };
            volumes[name] = null;
          }
          break;
        default:
          for (let i = 0; i < network.validators; i++) {
            const name = `${key}_val${i + 1}`;
            services[name] = {
              image: network.image,
              command: ['start', `--home=/opt`],
              entrypoint: [network.binary],
              volumes: [`${name}:/opt`],
              ...(i === 0 && {
                ports: [`127.0.0.1:${networkCounter + 26657}:26657`],
              }),
            };
            volumes[name] = null;
          }
      }
      networkCounter++;
    }

    for (const [index, relayer] of Object.entries(this.config.relayers || [])) {
      const name = `relayer_${relayer.type}${index}`;
      services[name] = {
        image: relayer.image,
        command: ['-c', `/root/start.sh`],
        volumes: [`${name}:/root`],
        entrypoint: ['/bin/bash'],
        depends_on: relayer.networks.map(
          (network) =>
            `${network}${
              this.config.networks[network].type === 'ics' ? '_ics' : '_val1'
            }`,
        ),
      };
      volumes[name] = null;
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
        if (Array.isArray(network.validators_balance)) {
          if (network.validators_balance.length !== network.validators) {
            throw new Error(
              `Network:${key} does not have validators_balance for all validators`,
            );
          }
        } else {
          if (
            typeof network.validators_balance !== 'string' ||
            !network.validators_balance.match(/^[0-9]+$/)
          ) {
            throw new Error(`Network:${key} validators_balance if wrong type`);
          }
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
      if (relayer.balance && !relayer.balance.match(/^[0-9]+$/)) {
        throw new Error(`Relayer balance is wrong`);
      }
    }
  };
}
