import {
  CosmoparkChain,
  CosmoparkNetworkConfig,
  CosmoparkRelayer,
  CosmoparkWallet,
} from './types';
import dockerCompose, { IDockerComposeResult } from 'docker-compose';
import { dockerCommand } from 'docker-cli-js';
import { rimraf } from 'rimraf';

export class CosmoparkDefaultChain implements CosmoparkChain {
  type: string;
  network: string;
  config: CosmoparkNetworkConfig;
  relayers: CosmoparkRelayer[] = [];
  containers: Record<string, string> = {};

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
    await rimraf('./gentx');
    await rimraf('./__*.tmp');
    await dockerCompose.down({
      cwd: process.cwd(),
      log: this.debug,
      commandOptions: ['-v'],
    });
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
    //add validators keys and balances
    await this.executeInAllValidators(
      (n: number) =>
        `echo "${mnemonic}" | ${this.config.binary} keys add val${
          n + 1
        } --home=/opt --recover --account=${n + 1} --keyring-backend=test`,
    );
    const validatorBalance = this.config.validators_balance;
    await this.executeInAllValidators(
      (n: number) =>
        `${this.config.binary} add-genesis-account val${n + 1} ${
          Array.isArray(validatorBalance)
            ? validatorBalance[n]
            : validatorBalance
        }${this.config.denom} --home=/opt --keyring-backend=test`,
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
      `cp $CONTAINER:/opt/config/gentx .`,
    );
    //collect peer ids
    const peerIds = (
      await this.executeInAllValidators(
        () => `${this.config.binary} tendermint show-node-id --home=/opt`,
      )
    ).map((v) => `${v.res.out.trim()}@${v.key}`);

    //compose genesis
    await dockerCommand(
      `cp /gentx ${this.containers[`${this.network}_val1`]}:/opt/config/`,
    );
    await this.execInValidator(
      `${this.network}_val1`,
      `${this.config.binary} collect-gentxs --home=/opt`,
    );

    await dockerCommand(
      `cp ${
        this.containers[`${this.network}_val1`]
      }:/opt/config/genesis.json ./___genesis.json.tmp`,
    );
    await dockerCommand(
      `cp ${
        this.containers[`${this.network}_val1`]
      }:/opt/config/config.toml ./___config.toml.tmp`,
    );
    await dockerCommand(
      `cp ${
        this.containers[`${this.network}_val1`]
      }:/opt/config/app.toml ./___app.toml.tmp`,
    );

    // docker cp $container:/opt/config/config.toml $(pwd)/_config.toml

    console.log({ peerIds });
    console.log('!!');
    console.log(wallets, mnemonic);
  }

  async executeForAllValidatorsContainers(command: string): Promise<any[]> {
    return Object.values(this.containers).map((container) =>
      dockerCommand(command.replace('$CONTAINER', container)),
    );
  }

  async stop(): Promise<void> {
    for (let i = 0; i < this.config.validators; i++) {
      const name = `${this.network}_val${i + 1}`;
      await dockerCompose.stopOne(name, { cwd: process.cwd(), log: true });
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
    c.debug = true;
    await c.start(wallets, mnemonic);
    return c;
  }
}
