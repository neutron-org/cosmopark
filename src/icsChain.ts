import {
  CosmoparkChain,
  CosmoparkNetworkConfig,
  CosmoparkRelayer,
  CosmoparkWallet,
} from './types';
import dockerCompose, { IDockerComposeResult } from 'docker-compose';
import { dockerCommand } from 'docker-cli-js';
import { rimraf } from 'rimraf';
import toml from '@iarna/toml';
import { promises as fs } from 'fs';
import _ from 'lodash';
import os from 'os';

export class CosmoparkIcsChain implements CosmoparkChain {
  type: string;
  network: string;
  config: CosmoparkNetworkConfig;
  relayers: CosmoparkRelayer[] = [];
  private container: string;

  debug = false;

  constructor(name: string, config: CosmoparkNetworkConfig) {
    this.type = config.type;
    this.config = config;
    this.network = name;
  }

  async start(wallets: Record<string, CosmoparkWallet>): Promise<void> {
    const tempDir = `${os.tmpdir()}/cosmopark/${this.network}`;
    await rimraf(tempDir);
    await fs.mkdir(tempDir, { recursive: true });

    const res = await dockerCompose.run(`${this.network}_ics`, 'infinity', {
      log: this.debug,
      cwd: process.cwd(),
      commandOptions: ['--rm', '--entrypoint=sleep', '-d'],
    });
    this.container = res.out.trim();

    //generate genesis
    await this.execInNode(
      `${this.config.binary} init ${this.network} --chain-id=${this.config.chain_id} --home=/opt`,
    );

    //add wallets and their balances
    await Promise.all(
      Object.entries(wallets).map(async ([name, wallet]) => {
        await this.execInNode(
          `echo "${wallet.mnemonic}" | ${this.config.binary} keys add ${name} --home=/opt --recover --keyring-backend=test`,
        );
        await this.execInNode(
          `${this.config.binary} add-genesis-account ${name} ${wallet.balance}${this.config.denom} --home=/opt --keyring-backend=test`,
        );
      }),
    );

    await Promise.all([
      this.executeForContainer(
        `cp $CONTAINER:/opt/config/genesis.json ${tempDir}/___genesis.json.tmp`,
      ),
      this.executeForContainer(
        `cp $CONTAINER:/opt/config/config.toml ${tempDir}/___config.toml.tmp`,
      ),
      this.executeForContainer(
        `cp $CONTAINER:/opt/config/app.toml ${tempDir}/___app.toml.tmp`,
      ),
    ]);

    //prepare configs
    if (this.config.genesis_opts) {
      await this.prepareGenesis(
        `${tempDir}/___genesis.json.tmp`,
        this.config.genesis_opts,
      );
    }
    await this.prepareTOML(`${tempDir}/___config.toml.tmp`, {
      'rpc.laddr': 'tcp://0.0.0.0:26657',
      'api.address': 'tcp://0.0.0.0:1317',
      ...(this.config.config_opts || {}),
    });

    if (this.config.app_opts) {
      await this.prepareTOML(
        `${tempDir}/___app.toml.tmp`,
        this.config.app_opts,
      );
    }
    //copy configs
    await Promise.all([
      this.executeForContainer(
        `cp ${tempDir}/___genesis.json.tmp $CONTAINER:/opt/config/genesis.json`,
      ),
      this.executeForContainer(
        `cp ${tempDir}/___app.toml.tmp $CONTAINER:/opt/config/app.toml`,
      ),
      this.executeForContainer(
        `cp ${tempDir}/___config.toml.tmp $CONTAINER:/opt/config/config.toml`,
      ),
    ]);
    await this.execInNode(
      `${this.config.binary} tendermint unsafe-reset-all --home=/opt`,
    );
    await this.execInNode(
      `${this.config.binary} add-consumer-section --home=/opt`,
    );
    //stop all containers
    await this.executeForContainer(`stop -t 0 $CONTAINER`);
  }

  private async executeForContainer(command: string): Promise<any[]> {
    return dockerCommand(command.replace('$CONTAINER', this.container), {
      echo: this.debug,
    });
  }

  private async prepareTOML(
    file: string,
    redefineOpts: Record<string, any>,
  ): Promise<void> {
    let data = toml.parse(await fs.readFile(file, 'utf-8'));
    for (const [key, value] of Object.entries(redefineOpts)) {
      data = _.set(data, key, value);
    }
    await fs.writeFile(file, toml.stringify(data));
  }

  private async prepareGenesis(
    file: string,
    redefineOpts: Record<string, any>,
  ): Promise<void> {
    let data = JSON.parse(await fs.readFile(file, 'utf-8'));
    for (const [key, value] of Object.entries(redefineOpts)) {
      data = _.set(data, key, value);
    }
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }

  async stop(): Promise<void> {
    for (let i = 0; i < this.config.validators; i++) {
      const name = `${this.network}_val${i + 1}`;
      await dockerCompose.stopOne(name, {
        cwd: process.cwd(),
        log: this.debug,
      });
    }
  }

  async restart(): Promise<void> {
    for (let i = 0; i < this.config.validators; i++) {
      const name = `${this.network}_val${i + 1}`;
      await dockerCompose.restartOne(name, {
        cwd: process.cwd(),
        log: true,
      });
    }
  }

  async execInNode(command: string): Promise<IDockerComposeResult> {
    return dockerCompose.exec(`${this.network}_ics`, [`sh`, `-c`, command], {
      log: this.debug,
    });
  }

  async startValidator(): Promise<void> {
    throw new Error('No validators in ics chain');
  }

  async stopValidator(): Promise<void> {
    throw new Error('No validators in ics chain');
  }

  static async create(
    name: string,
    config: CosmoparkNetworkConfig,
    wallets: {
      [key: string]: CosmoparkWallet;
    },
  ): Promise<CosmoparkIcsChain> {
    const c = new CosmoparkIcsChain(name, config);
    await c.start(wallets);
    return c;
  }
}
