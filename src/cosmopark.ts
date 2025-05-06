import YAML from 'yaml';
import fs from 'fs';
import dockerCompose, { IDockerComposeResult } from 'docker-compose';
import { dockerCommand } from 'docker-cli-js';
import pino from 'pino';

import {
  CosmoparkChain,
  CosmoparkConfig,
  CosmoparkNetworkPortOutput,
  CosmoparkWallet,
} from './types';
import { CosmoparkDefaultChain } from './chains/standardChain';
import { CosmoparkHermesRelayer } from './relayers/hermes';
import { logger } from './logger';
import { getMutexCounter, releaseMutex } from './mutex';
import { CosmoparkCoordinatorRelayer } from './relayers/coordinator';

export class Cosmopark {
  private context: string;
  private filename: string;
  logLevel: pino.Level = 'info';
  ports: Record<string, CosmoparkNetworkPortOutput> = {};
  config: CosmoparkConfig;
  networks: Record<string, CosmoparkChain> = {};
  relayers: (CosmoparkHermesRelayer | CosmoparkCoordinatorRelayer)[] = []; //TODO: add relayers type
  constructor(config: CosmoparkConfig) {
    this.config = config;
    this.context = config.context || 'cosmopark';
    process.env.COMPOSE_PROJECT_NAME = this.context;
    this.filename = config.context
      ? `docker-compose-${config.context}.yml`
      : 'docker-compose.yml';
  }

  static async create(config: CosmoparkConfig): Promise<Cosmopark> {
    logger.level = config.loglevel;
    const logContext = logger.child({ context: 'main' });
    logContext.debug('start cosmopark');
    const ver = await dockerCompose.version();
    logContext.debug({ ver }, 'docker-compose version');
    if (ver.exitCode !== 0 || !ver.data.version.match(/^[2-9]/gi)) {
      logContext.error(
        `Docker compose version should be 2 or higher, found ${ver.data.version}`,
      );
      throw new Error(
        `Docker compose version should be 2 or higher, found ${ver.data.version}`,
      );
    }
    logContext.debug('docker-compose version is ok');
    const counter = await getMutexCounter();
    logContext.debug({ counter }, 'counter of instances');
    const instance = new Cosmopark({ portOffset: counter * 100, ...config });
    if (fs.existsSync(instance.filename)) {
      instance.validateConfig(config);
      logContext.debug('config is valid');
      try {
        const res = await dockerCompose.down({
          config: instance.filename,
          cwd: process.cwd(),
          log: false,
          commandOptions: ['-v', '--remove-orphans'],
        });
        logContext.debug({ res }, 'docker-compose down');
      } catch (e) {
        logContext.error({ e }, 'docker-compose down error');
        const res = await dockerCompose.ps({ commandOptions: ['-a'] });
        logContext.debug({ res }, 'docker-compose ps');
        if (res.exitCode === 0) {
          const containers = res.out
            .split('\n')
            .filter((v) => v.match(/cosmopark_/))
            .map((v) => v.split(' ')[0]);
          logContext.debug({ containers }, 'containers to stop');
          await dockerCommand(`stop -t0 ${containers.join(' ')}`);
          logContext.debug('containers stopped');
          const downRes = await dockerCompose.down({
            cwd: process.cwd(),
            log: false,
            commandOptions: ['-v', '--remove-orphans'],
          });
          logContext.debug(downRes, 'docker-compose down');
        } else {
          logContext.error({ e }, 'docker-compose ps error');
          throw e;
        }
      }
    }
    logContext.debug('generate docker-compose yaml file');
    await instance.generateDockerCompose();
    // just in case there are some volumes left
    try {
      const res = await dockerCompose.down({
        config: instance.filename,
        cwd: process.cwd(),
        log: false,
        commandOptions: ['-v', '--remove-orphans'],
      });
      logContext.debug({ res }, 'docker-compose down');
    } catch (e) {
      //
    }
    logContext.debug('docker-compose yaml file generated');
    const relayerWallets: Record<string, CosmoparkWallet> =
      config.relayers
        ?.map((relayer) => ({
          mnemonic: relayer.mnemonic,
          balance: relayer.balance,
        }))
        .reduce((a, c, idx) => ({ ...a, [`relayer_${idx}`]: c }), {}) || {};
    for (const [key, network] of Object.entries(config.networks)) {
      logContext.debug('create default chain');
      instance.networks[key] = await CosmoparkDefaultChain.create(
        key,
        network,
        { ...config.wallets, ...relayerWallets },
        config.master_mnemonic,
        instance.filename,
      );
    }
    for (const [index, relayer] of Object.entries(config.relayers || [])) {
      switch (relayer.type) {
        case 'hermes':
          logContext.debug('create hermes relayer');
          instance.relayers.push(
            await CosmoparkHermesRelayer.create(
              `relayer_${relayer.type}${index}`,
              relayer,
              config.networks,
              instance.filename,
            ),
          );
          break;
        case 'neutron':
          // nothing to do here
          break;
        case 'coordinator':
          instance.relayers.push(
            new CosmoparkCoordinatorRelayer(
              `relayer_${relayer.type}${index}`,
              relayer.type,
              instance.filename,
            ),
          );
          break;
        default:
          throw new Error(`Relayer type ${relayer.type} is not supported`);
      }
    }
    logContext.debug('docker-compose up');
    const resUp = await dockerCompose.upAll({
      config: instance.filename,
      cwd: process.cwd(),
      log: false,
    });
    logContext.debug({ resUp }, 'docker-compose up result');
    if (config.awaitFirstBlock) {
      logContext.debug('await first block');
      await instance.awaitFirstBlock();
      logContext.debug('first block received');
    }
    for (const [chainName, chainInstance] of Object.entries(
      instance.networks,
    )) {
      if (config.networks[chainName].post_start) {
        for (const command of config.networks[chainName].post_start) {
          logContext.debug({ chainName, command }, 'exec post start command');
          await chainInstance.execInSomewhere(command);
        }
      }
    }
    logContext.debug('cosmopark started');
    return instance;
  }

  awaitFirstBlock = async (): Promise<void> => {
    const timeout = 1000 * 30;
    const start = Date.now();
    logger.debug('await first block');
    while (Date.now() - start < timeout) {
      try {
        const all = await Promise.all(
          Object.entries(this.ports).map(async ([, ports]) => {
            try {
              const res = await fetch(`http://127.0.0.1:${ports.rpc}/status`);
              const json = await res.json();
              logger.debug(json, 'await first block res ok');
              return Number(json.result.sync_info.latest_block_height) > 0;
            } catch (e) {
              logger.debug(e, 'await first block error');
              return false;
            }
          }),
        );
        if (all.every((v) => v)) {
          return;
        }
      } catch (e) {
        //noop
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    logger.error('timeout waiting for first block');
    throw new Error(`Timeout waiting for first block`);
  };

  async pauseRelayer(
    type: 'hermes' | 'neutron' | 'coordinator',
    index: number,
  ): Promise<void> {
    await dockerCompose.pauseOne(`relayer_${type}${index}`);
  }

  async stopRelayer(
    type: 'hermes' | 'neutron' | 'coordinator',
    index: number,
  ): Promise<void> {
    await dockerCompose.stopOne(`relayer_${type}${index}`);
  }

  async resumeRelayer(
    type: 'hermes' | 'neutron' | 'coordinator',
    index: number,
  ): Promise<void> {
    await dockerCompose.unpauseOne(`relayer_${type}${index}`);
  }

  async restartRelayer(
    type: 'hermes' | 'neutron' | 'coordinator',
    index: number,
  ): Promise<void> {
    await dockerCompose.restartOne(`relayer_${type}${index}`);
  }

  async pauseNetwork(network: string): Promise<void> {
    for (let i = 0; i++; i < this.networks[network].config.validators) {
      await dockerCompose.pauseOne(`${network}_val${i + 1}`);
    }
  }

  executeInNetwork = (
    network: string,
    command: string,
  ): Promise<IDockerComposeResult> =>
    this.networks[network].execInSomewhere(command);

  stop = async (): Promise<void> => {
    await dockerCompose.down({
      config: this.filename,
      cwd: process.cwd(),
      log: false,
      commandOptions: ['-v', '--remove-orphans', '-t0'],
    });
    await releaseMutex();
  };

  generateDockerCompose = (): void => {
    const services = {};
    const volumes = {};
    let networkCounter = 0;
    const portOffset = this.config.portOffset || 0;
    for (const [key, network] of Object.entries(this.config.networks)) {
      const rpcPort = portOffset + networkCounter + 26657;
      const restPort = portOffset + networkCounter + 1317;
      const grpcPort = portOffset + networkCounter + 9090;
      const service_interface = network.public ? '' : '127.0.0.1:';
      this.ports[key] = {
        rpc: rpcPort,
        rest: restPort,
        grpc: grpcPort,
      };
      logger.debug('generate docker-compose for network %o', network);
      for (let i = 0; i < network.validators; i++) {
        const name = `${key}_val${i + 1}`;
        services[name] = {
          image: network.image,
          command: [
            'start',
            `--home=/opt`,
            `--log_level=debug`,
            `--pruning=nothing`,
            `--log_format=${network.loglevel || 'info'}`,
            ...(network.trace ? ['--trace'] : []),
          ],
          entrypoint: [network.binary],
          volumes: [`${name}:/opt`],
          ...(i === 0 && {
            ports: [
              `${service_interface}${
                portOffset + networkCounter + 26657
              }:26657`,
              `${service_interface}${portOffset + networkCounter + 1317}:1317`,
              `${service_interface}${portOffset + networkCounter + 9090}:9090`,
            ],
          }),
        };
        volumes[name] = null;
      }
      networkCounter++;
    }
    const prevConnections = [];
    for (const [index, relayer] of Object.entries(this.config.relayers || [])) {
      const name = `relayer_${relayer.type}${index}`;
      if (relayer.type === 'hermes') {
        services[name] = {
          image: relayer.image,
          command: ['-c', `/root/start.sh`],
          volumes: [`${name}:/root`],
          entrypoint: ['/bin/bash'],
          depends_on: relayer.networks.map((network) => `${network}_val1`),
        };
        volumes[name] = null;
        prevConnections.push(...(relayer.connections || []));
      } else if (relayer.type === 'neutron' || relayer.type === 'coordinator') {
        let id = 0;
        const neutronNetwork = relayer.networks.find(
          (network) => this.config.networks[network].prefix === 'neutron',
        );
        const targetNetwork = relayer.networks.find(
          (network) => this.config.networks[network].prefix !== 'neutron',
        );
        for (const [network1, network2] of prevConnections) {
          if (
            (network1 === neutronNetwork && network2 === targetNetwork) ||
            (network2 === neutronNetwork && network1 === targetNetwork)
          ) {
            break;
          }
          if (network1 === neutronNetwork || network2 === neutronNetwork) {
            id++;
          }
        }
        if (!neutronNetwork || !targetNetwork) {
          throw new Error(
            `Relayer:${relayer.type} should be linked to 2 networks (1 neutron and 1 default)`,
          );
        }

        let environment: Record<string, string | number | boolean> = {
          NODE: `${neutronNetwork}_val1`,
          LOGGER_LEVEL: relayer.log_level,
          RELAYER_NEUTRON_CHAIN_CHAIN_PREFIX:
            this.config.networks[neutronNetwork].prefix,
          RELAYER_NEUTRON_CHAIN_RPC_ADDR: `tcp://${neutronNetwork}_val1:26657`,
          RELAYER_NEUTRON_CHAIN_REST_ADDR: `http://${neutronNetwork}_val1:1317`,
          RELAYER_NEUTRON_CHAIN_HOME_DIR: '/data',
          RELAYER_NEUTRON_CHAIN_SIGN_KEY_NAME: `relayer_${index}`,
          RELAYER_NEUTRON_CHAIN_GAS_PRICES: `0.5${this.config.networks[neutronNetwork].denom}`,
          RELAYER_NEUTRON_CHAIN_GAS_ADJUSTMENT: 1.5,
          RELAYER_NEUTRON_CHAIN_DENOM:'untrn',
          RELAYER_NEUTRON_CHAIN_MAX_GAS_PRICE: 1000,
          RELAYER_NEUTRON_CHAIN_GAS_PRICE_MULTIPLIER: 1.1,
          RELAYER_NEUTRON_CHAIN_CONNECTION_ID: `connection-${id}`,
          RELAYER_NEUTRON_CHAIN_DEBUG: true,
          RELAYER_NEUTRON_CHAIN_ACCOUNT_PREFIX:
            this.config.networks[neutronNetwork].prefix,
          RELAYER_NEUTRON_CHAIN_KEYRING_BACKEND: 'test',
          RELAYER_TARGET_CHAIN_RPC_ADDR: `tcp://${targetNetwork}_val1:26657`,
          RELAYER_TARGET_CHAIN_REST_ADDR: `http://${targetNetwork}_val1:1317`,
          RELAYER_TARGET_CHAIN_DENOM: this.config.networks[targetNetwork].denom,
          RELAYER_TARGET_CHAIN_GAS_PRICES: `0.5${this.config.networks[targetNetwork].denom}`,
          RELAYER_TARGET_CHAIN_ACCOUNT_PREFIX:
            this.config.networks[targetNetwork].prefix,
          RELAYER_TARGET_CHAIN_VALIDATOR_ACCOUNT_PREFIX: `${this.config.networks[targetNetwork].prefix}valoper`,
          RELAYER_TARGET_CHAIN_DEBUG: true,
          RELAYER_ALLOW_KV_CALLBACKS: true,
        };

        if (relayer.type === 'neutron') {
          environment = {
            ...environment,
            RELAYER_REGISTRY_ADDRESSES: '',
            RELAYER_ALLOW_TX_QUERIES: true,
            RELAYER_STORAGE_PATH: '/data/relayer/storage/leveldb',
            RELAYER_LISTEN_ADDR: '0.0.0.0:9999',
          };
        } else {
          environment = {
            ...environment,
            COORDINATOR_MNEMONIC: relayer.mnemonic,
            COORDINATOR_LOG_LEVEL: 'debug',
            ICQ_RUN_COMMAND: 'neutron_query_relayer run',
            COORDINATOR_CHECKS_PERIOD: 5,
          };
        }
        services[name] = {
          image: relayer.image,
          entrypoint: ['./run.sh'],
          depends_on: relayer.networks.map((network) => `${network}_val1`),
          volumes: [`${neutronNetwork}_val1:/data`],
          environment: Object.entries({
            ...environment,
            ...relayer.environment,
          }).map(([k, v]) => `${k}=${v}`),
        };
      }
    }

    if (this.config.custom_containers) {
      for (const container of this.config.custom_containers) {
        services[container.name] = {
          image: container.image,
          entrypoint: container.entrypoint.split(' '),
          ports: container.ports,
          depends_on: container.depends_on,
          volumes: container.volumes,
        };
      }
    }

    const dockerCompose = {
      version: '3',
      services,
      volumes,
    };
    logger.debug('docker-compose %o', dockerCompose);
    fs.writeFileSync(
      this.filename,
      YAML.stringify(dockerCompose, {
        indent: 2,
        lineWidth: -1,
        aliasDuplicateObjects: false,
      }),
    );
  };

  validateConfig = (config: CosmoparkConfig) => {
    const networks = new Set(Object.keys(config.networks));
    const relayers = config.relayers || [];

    if (config.context && !config.context.match(/^[a-z0-9]+$/)) {
      throw new Error(`Context should be lowercase alphanumeric`);
    }

    if (config.portOffset && !Number.isFinite(config.portOffset)) {
      throw new Error(`Port offset should be number`);
    }

    if (
      config.loglevel &&
      !Object.values(pino.levels.labels).includes(config.loglevel)
    ) {
      throw new Error(
        `Log level should be one of ${Object.values(pino.levels.labels).join(
          ', ',
        )}`,
      );
    } else {
      config.loglevel = 'info';
    }

    for (const [key, network] of Object.entries(config.networks)) {
      if (!network.validators_balance) {
        throw new Error(`Network:${key} does not have validators_balance`);
      }
      if (Array.isArray(network.validators_balance)) {
        if (network.validators_balance.length < network.validators) {
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

    for (const relayer of relayers) {
      for (const network of relayer.networks) {
        if (!networks.has(network)) {
          throw new Error(
            `Relayer is linked to the network:${network} is not defined`,
          );
        }
      }
      if (relayer.type === 'neutron') {
        if (relayer.networks.length !== 2) {
          throw new Error(
            `Relayer:${relayer.type} should be linked to 2 networks`,
          );
        }
      }
      if (relayer.type === 'hermes') {
        if (!relayer.connections || relayer.connections.length === 0) {
          throw new Error(`Relayer:${relayer.type} should have connections`);
        }
      }
      if (relayer.balance && !relayer.balance.match(/^[0-9]+$/)) {
        throw new Error(`Relayer balance is wrong`);
      }
    }
  };
}
