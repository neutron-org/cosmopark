import dockerCompose, { IDockerComposeResult } from 'docker-compose';
import { dockerCommand } from 'docker-cli-js';
import { rimraf } from 'rimraf';
import toml from '@iarna/toml';
import { promises as fs } from 'fs';
import _ from 'lodash';
import os from 'os';
import { Logger } from 'pino';

import {
  CosmoparkChain,
  CosmoparkNetworkConfig,
  CosmoparkRelayer,
  CosmoparkWallet,
} from '../types';
import { logger } from '../logger';

export class CosmoparkIcsChain implements CosmoparkChain {
  type: string;
  network: string;
  config: CosmoparkNetworkConfig;
  relayers: CosmoparkRelayer[] = [];
  filename: string;
  private container: string;
  logger: Logger;

  constructor(name: string, config: CosmoparkNetworkConfig, filename: string) {
    this.type = config.type;
    this.config = config;
    this.network = name;
    this.filename = filename;
    this.logger = logger.child({ chain: this.network });
  }

  async start(wallets: Record<string, CosmoparkWallet>): Promise<void> {
    this.logger.info(`Starting ics chain ${this.network}`);
    const tempDir = `${os.tmpdir()}/cosmopark/${this.network}_${
      process.env.COMPOSE_PROJECT_NAME
    }`;
    this.logger.debug(`Removing temp dir: ${tempDir}`);
    await rimraf(tempDir);
    this.logger.debug(`Creating temp dir: ${tempDir}`);
    await fs.mkdir(tempDir, { recursive: true });

    const res = await dockerCompose.run(`${this.network}_ics`, 'infinity', {
      config: this.filename,
      log: false,
      cwd: process.cwd(),
      commandOptions: ['--rm', '--entrypoint=sleep', '-d'],
    });
    this.logger.debug(res, 'start container to run init stuff');
    this.container = res.out.trim();

    //generate genesis
    await this.execInNode(
      `${this.config.binary} init ${this.network} --chain-id=${this.config.chain_id} --home=/opt`,
    );

    this.logger.debug(`Creating wallets for ${this.network}`);
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
    this.logger.debug(`Copying configs from container ${this.container}`);
    await Promise.all([
      this.execForContainer(
        `cp $CONTAINER:/opt/config/genesis.json ${tempDir}/___genesis.json.tmp`,
      ),
      this.execForContainer(
        `cp $CONTAINER:/opt/config/config.toml ${tempDir}/___config.toml.tmp`,
      ),
      this.execForContainer(
        `cp $CONTAINER:/opt/config/app.toml ${tempDir}/___app.toml.tmp`,
      ),
    ]);

    //prepare configs
    this.logger.debug(`Preparing configs`);
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
    this.logger.debug(`Copying configs to container ${this.container}`);
    await Promise.all([
      this.execForContainer(
        `cp ${tempDir}/___genesis.json.tmp $CONTAINER:/opt/config/genesis.json`,
      ),
      this.execForContainer(
        `cp ${tempDir}/___app.toml.tmp $CONTAINER:/opt/config/app.toml`,
      ),
      this.execForContainer(
        `cp ${tempDir}/___config.toml.tmp $CONTAINER:/opt/config/config.toml`,
      ),
    ]);
    this.logger.debug(`unsafe-reset-all`);
    await this.execInNode(
      `${this.config.binary} tendermint unsafe-reset-all --home=/opt`,
    );
    this.logger.debug(`add-consumer-section`);
    await this.execInNode(
      `${this.config.binary} add-consumer-section --home=/opt`,
    );

    //upload files
    if (this.config.upload) {
      await Promise.all(
        this.config.upload.map(async (path) => {
          await this.execForContainer(`cp ${path} $CONTAINER:/opt/`);
        }),
      );
    }
    //exec post init commands
    if (this.config.post_init) {
      for (const command of this.config.post_init) {
        await this.execInNode(command);
      }
    }

    //stop all containers
    await this.execForContainer(`stop -t 0 $CONTAINER`);
  }

  private async execForContainer(command: string): Promise<any[]> {
    this.logger.debug(
      `Executing command in container ${this.container}: ${command}`,
    );
    const out = await dockerCommand(
      command.replace('$CONTAINER', this.container),
      {
        echo: false,
      },
    );
    this.logger.debug(out, 'exec result');
    return out;
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
      const res = await dockerCompose.stopOne(name, {
        config: this.filename,
        cwd: process.cwd(),
        log: false,
      });
      this.logger.debug(res, 'stop result');
    }
  }

  async restart(): Promise<void> {
    for (let i = 0; i < this.config.validators; i++) {
      const name = `${this.network}_val${i + 1}`;
      await dockerCompose.restartOne(name, {
        config: this.filename,
        cwd: process.cwd(),
        log: true,
      });
    }
  }

  async execInNode(command: string): Promise<IDockerComposeResult> {
    this.logger.debug(
      `Executing command in node ${this.network} ${this.network}_ics: ${command}`,
    );

    const res = await dockerCompose.exec(
      `${this.network}_ics`,
      [`sh`, `-c`, command],
      {
        log: false,
        config: this.filename,
      },
    );
    this.logger.debug(res, 'exec result');
    if (res.exitCode !== 0) {
      this.logger.error(res.out);
      throw new Error(res.out);
    }
    return res;
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
    filename: string,
  ): Promise<CosmoparkIcsChain> {
    const c = new CosmoparkIcsChain(name, config, filename);
    await c.start(wallets);
    return c;
  }

  async execInSomewhere(command: string): Promise<IDockerComposeResult> {
    return await this.execInNode(command);
  }
}
