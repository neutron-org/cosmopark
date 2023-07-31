import {
  CosmoparkChain,
  CosmoparkNetworkConfig,
  CosmoparkRelayer,
  CosmoparkWallet,
} from '../types';
import dockerCompose, { IDockerComposeResult } from 'docker-compose';
import { dockerCommand } from 'docker-cli-js';
import { rimraf } from 'rimraf';
import toml from '@iarna/toml';
import { promises as fs } from 'fs';
import _ from 'lodash';
import os from 'os';

export class CosmoparkDefaultChain implements CosmoparkChain {
  type: string;
  network: string;
  config: CosmoparkNetworkConfig;
  relayers: CosmoparkRelayer[] = [];
  private containers: Record<string, string> = {};

  debug = false;

  constructor(name: string, config: CosmoparkNetworkConfig) {
    this.type = config.type;
    this.config = config;
    this.network = name;
  }

  async start(
    wallets: Record<string, CosmoparkWallet>,
    mnemonic: string,
  ): Promise<void> {
    const tempDir = `${os.tmpdir()}/cosmopark/${this.network}`;
    await rimraf(tempDir);
    await fs.mkdir(tempDir, { recursive: true });
    for (let i = 0; i < this.config.validators; i++) {
      const res = await dockerCompose.run(
        `${this.network}_val${i + 1}`,
        'sleep infinity',
        {
          log: this.debug,
          cwd: process.cwd(),
          commandOptions: ['--rm', '--entrypoint', 'sleep infinity', '-d'],
        },
      );
      if (res.exitCode !== 0) {
        throw new Error(res.err);
      }
      this.containers[`${this.network}_val${i + 1}`] = res.out.trim();
    }
    //generate genesis
    await this.executeInAllValidators(
      (n: number) =>
        `${this.config.binary} init val${this.network}${n} --chain-id=${this.config.chain_id} --home=/opt`,
    );
    const validatorBalance = this.config.validators_balance;
    //add all validators keys and balances
    await Promise.all(
      new Array(this.config.validators).fill(0).map(async (_, i) => {
        await this.executeInAllValidators(
          () =>
            `echo "${mnemonic}" | ${this.config.binary} keys add val${
              i + 1
            } --home=/opt --recover --account=${i + 1} --keyring-backend=test`,
        );
        await this.executeInAllValidators(
          () =>
            `${this.config.binary} add-genesis-account val${i + 1} ${
              Array.isArray(validatorBalance)
                ? validatorBalance[i]
                : validatorBalance
            }${this.config.denom} --home=/opt --keyring-backend=test`,
        );
      }),
    );
    //add wallets and their balances
    await Promise.all(
      Object.entries(wallets).map(async ([name, wallet]) => {
        await this.executeInAllValidators(
          () =>
            `echo "${wallet.mnemonic}" | ${this.config.binary} keys add ${name} --home=/opt --recover --keyring-backend=test`,
        );
        await this.executeInAllValidators(
          () =>
            `${this.config.binary} add-genesis-account ${name} ${wallet.balance}${this.config.denom} --home=/opt --keyring-backend=test`,
        );
      }),
    );
    //gentx
    await this.executeInAllValidators(
      (n: number) =>
        `${this.config.binary} gentx val${n + 1} ${
          Array.isArray(validatorBalance)
            ? validatorBalance[n]
            : validatorBalance
        }${this.config.denom} --home=/opt --keyring-backend=test --chain-id=${
          this.config.chain_id
        }`,
    );
    //collect gentxs
    await this.executeForAllValidatorsContainers(
      `cp $CONTAINER:/opt/config/gentx ${tempDir}/`,
    );
    //collect peer ids
    const peerIds = (
      await this.executeInAllValidators(
        () => `${this.config.binary} tendermint show-node-id --home=/opt`,
      )
    ).map((v) => `${v.res.out.trim()}@${v.key}:26656`);

    //compose genesis
    await dockerCommand(
      `cp ${tempDir}/gentx ${
        this.containers[`${this.network}_val1`]
      }:/opt/config/`,
    );
    await this.execInValidator(
      `${this.network}_val1`,
      `${this.config.binary} collect-gentxs --home=/opt`,
    );
    // retrieve configs

    await Promise.all([
      dockerCommand(
        `cp ${
          this.containers[`${this.network}_val1`]
        }:/opt/config/genesis.json ${tempDir}/___genesis.json.tmp`,
      ),
      dockerCommand(
        `cp ${
          this.containers[`${this.network}_val1`]
        }:/opt/config/config.toml ${tempDir}/___config.toml.tmp`,
      ),
      dockerCommand(
        `cp ${
          this.containers[`${this.network}_val1`]
        }:/opt/config/app.toml ${tempDir}/___app.toml.tmp`,
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
      'p2p.persistent_peers': peerIds.join(','),
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
      this.executeForAllValidatorsContainers(
        `cp ${tempDir}/___genesis.json.tmp $CONTAINER:/opt/config/genesis.json`,
      ),
      this.executeForAllValidatorsContainers(
        `cp ${tempDir}/___app.toml.tmp $CONTAINER:/opt/config/app.toml`,
      ),
      this.executeForAllValidatorsContainers(
        `cp ${tempDir}/___config.toml.tmp $CONTAINER:/opt/config/config.toml`,
      ),
    ]);

    //stop all containers
    await this.executeForAllValidatorsContainers('stop -t 0 $CONTAINER');
  }

  private async executeForAllValidatorsContainers(
    command: string,
  ): Promise<any[]> {
    return Object.values(this.containers).map((container) =>
      dockerCommand(command.replace('$CONTAINER', container), {
        echo: this.debug,
      }),
    );
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

  async executeInAllValidators(
    command: (n: number) => string,
  ): Promise<{ res: IDockerComposeResult; key: string }[]> {
    const validators = new Array(this.config.validators).fill(0);
    return Promise.all(
      validators.map(async (_, i) => ({
        res: await this.execInValidator(
          `${this.network}_val${i + 1}`,
          command(i),
        ),
        key: `${this.network}_val${i + 1}`,
      })),
    );
  }

  async execInValidator(
    validator: string,
    command: string,
  ): Promise<IDockerComposeResult> {
    return dockerCompose.exec(validator, [`sh`, `-c`, command], {
      log: this.debug,
    });
  }

  async startValidator(n: number): Promise<void> {
    console.log('startValidator', n);
  }
  async stopValidator(n: number): Promise<void> {
    console.log('stopValidator', n);
  }
  static async create(
    name: string,
    config: CosmoparkNetworkConfig,
    wallets: {
      [key: string]: CosmoparkWallet;
    },
    mnemonic: string,
  ): Promise<CosmoparkDefaultChain> {
    const c = new CosmoparkDefaultChain(name, config);
    await c.start(wallets, mnemonic);
    return c;
  }
}
