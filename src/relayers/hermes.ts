import { CosmoparkNetworkConfig, CosmoparkRelayer } from '../types';
import dockerCompose, { IDockerComposeResult } from 'docker-compose';
import { dockerCommand } from 'docker-cli-js';
import toml from '@iarna/toml';
import { promises as fs } from 'fs';
import os from 'os';
import _ from 'lodash';
import { rimraf } from 'rimraf';

const ccvChainConfig = {
  id: '', //chain-id
  rpc_addr: '',
  grpc_addr: '',
  websocket_addr: '',
  rpc_timeout: '10s',
  account_prefix: '',
  key_name: '',
  store_prefix: 'ibc',
  default_gas: 3000000,
  max_gas: 5000000,
  gas_price: {
    price: 0.005,
    denom: '',
  },
  gas_multiplier: 1.1,
  max_msg_num: 20,
  max_tx_size: 180000,
  clock_drift: '15s',
  max_block_time: '30s',
  trusting_period: '320hours',
  trust_threshold: {
    numerator: '1',
    denominator: '3',
  },
  ccv_consumer_chain: true,
  packet_filter: {
    policy: 'allow',
    list: [['*', '*']],
  },
};

const standardChainConfig = {
  id: '',
  rpc_addr: '',
  grpc_addr: '',
  websocket_addr: '',
  rpc_timeout: '10s',
  account_prefix: '',
  key_name: '',
  store_prefix: 'ibc',
  max_gas: 5000000,
  gas_price: {
    price: 0.007,
    denom: '',
  },
  gas_multiplier: 1.1,
  clock_drift: '10s',
  trusting_period: '112hours',
  trust_threshold: {
    numerator: '1',
    denominator: '3',
  },
  packet_filter: {
    policy: 'allow',
    list: [['*', '*']],
  },
};

const baseConfig = {
  global: {
    log_level: 'info',
  },
  mode: {
    clients: {
      enabled: true,
      refresh: true,
      misbehaviour: true,
    },
    connections: {
      enabled: true,
    },
    channels: {
      enabled: true,
    },
    packets: {
      enabled: true,
      clear_interval: 150,
      clear_on_start: true,
      tx_confirmation: true,
    },
  },
  rest: {
    enabled: true,
    host: '127.0.0.1',
    port: 3000,
  },
  telemetry: {
    enabled: true,
    host: '0.0.0.0',
    port: 3001,
  },
  chains: [],
};
export class CosmoparkHermesRelayer {
  private name: string;
  private container: string;
  private config: CosmoparkRelayer;
  private networksConfig: Record<string, CosmoparkNetworkConfig>;

  debug = false;
  constructor(
    name: string,
    config: CosmoparkRelayer,
    networksConfig: Record<string, CosmoparkNetworkConfig>,
  ) {
    this.name = name;
    this.config = config;
    this.networksConfig = networksConfig;
  }

  async start(): Promise<void> {
    const tempPath = `${os.tmpdir()}/cosmopark/${this.name}`;
    await rimraf(tempPath);
    await fs.mkdir(tempPath, { recursive: true });
    const res = await dockerCompose.run(this.name, 'infinity', {
      log: this.debug,
      cwd: process.cwd(),
      commandOptions: ['--rm', '--entrypoint=sleep', '-d'],
    });
    this.container = res.out.trim();
    const config = this.prepareConfig();
    await fs.writeFile(`${tempPath}/config.toml`, toml.stringify(config));
    await this.execInNode(`mkdir -p /root/.hermes`);
    await this.execForContainer(
      `cp ${tempPath}/config.toml $CONTAINER:/root/.hermes/config.toml`,
    );
    await this.execInNode(`echo "${this.config.mnemonic}" > mnemonic.txt`);
    await Promise.all(
      this.config.networks.map((network) =>
        this.execInNode(
          `${this.config.binary} keys add --key-name key-${network} --chain ${this.networksConfig[network].chain_id} --mnemonic-file mnemonic.txt`,
        ),
      ),
    );
    const starter = this.prepareStarter();
    await fs.writeFile(`${tempPath}/start.sh`, starter, { mode: 0o755 });
    await this.execForContainer(
      `cp ${tempPath}/start.sh $CONTAINER:/root/start.sh`,
    );
    await this.execForContainer(`stop $CONTAINER -t0`);
    await rimraf(tempPath);
  }

  prepareConfig(): any {
    const config = _.cloneDeep(baseConfig);
    config.global.log_level = this.config.log_level;
    const networks: { key: string; config: CosmoparkNetworkConfig }[] = [];
    for (const network of this.config.networks) {
      networks.push({ key: network, config: this.networksConfig[network] });
    }
    for (const network of networks) {
      let chainConfig;
      let nodeKey;
      switch (network.config.type) {
        case 'ics':
          chainConfig = _.cloneDeep(ccvChainConfig);
          nodeKey = `${network.key}_ics`;
          break;
        default:
          chainConfig = _.cloneDeep(standardChainConfig);
          nodeKey = `${network.key}_val1`;
      }
      chainConfig.id = network.config.chain_id;
      chainConfig.rpc_addr = `http://${nodeKey}:26657`;
      chainConfig.grpc_addr = `http://${nodeKey}:9090`;
      chainConfig.websocket_addr = `ws://${nodeKey}:26657/websocket`;
      chainConfig.account_prefix = network.config.prefix;
      chainConfig.key_name = `key-${network.key}`;
      chainConfig.gas_price.denom = network.config.denom;
      config.chains.push(chainConfig);
    }
    return config;
  }

  private prepareStarter() {
    let out = `#!/bin/bash\n`;
    const done = new Set<string>();
    for (const network1 of this.config.networks) {
      for (const network2 of this.config.networks) {
        const key = [network1, network2].sort().join('-');
        if (network1 !== network2 && !done.has(key)) {
          done.add(key);
          out += `while ! echo "y" | ${this.config.binary} create channel --a-chain ${this.networksConfig[network1].chain_id} --b-chain ${this.networksConfig[network2].chain_id} --a-port transfer --b-port transfer --yes --new-client-connection; do
    sleep 5
done
`;
        }
      }
    }
    out += 'hermes start';
    return out;
  }

  private async execForContainer(command: string): Promise<any[]> {
    return dockerCommand(command.replace('$CONTAINER', this.container), {
      echo: this.debug,
    });
  }

  async execInNode(command: string): Promise<IDockerComposeResult> {
    return dockerCompose.exec(this.name, [`sh`, `-c`, command], {
      log: this.debug,
    });
  }

  static async create(
    name: string,
    config: CosmoparkRelayer,
    networksConfig: Record<string, CosmoparkNetworkConfig>,
  ): Promise<CosmoparkHermesRelayer> {
    const instance = new CosmoparkHermesRelayer(name, config, networksConfig);
    await instance.start();
    return instance;
  }
}