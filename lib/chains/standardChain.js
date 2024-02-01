"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmoparkDefaultChain = void 0;
const docker_compose_1 = __importDefault(require("docker-compose"));
const docker_cli_js_1 = require("docker-cli-js");
const rimraf_1 = require("rimraf");
const toml_1 = __importDefault(require("@iarna/toml"));
const fs_1 = require("fs");
const lodash_1 = __importDefault(require("lodash"));
const os_1 = __importDefault(require("os"));
const logger_1 = require("../logger");
class CosmoparkDefaultChain {
    filename;
    type;
    network;
    config;
    relayers = [];
    containers = {};
    logger;
    constructor(name, config, filename) {
        this.type = config.type;
        this.config = config;
        this.network = name;
        this.filename = filename;
        this.logger = logger_1.logger.child({ chain: this.network });
    }
    async start(wallets, mnemonic) {
        this.logger.info(`Starting default chain ${this.network}`);
        this.logger.debug(`Removing temp dir: ${os_1.default.tmpdir()}/cosmopark`);
        const tempDir = `${os_1.default.tmpdir()}/cosmopark/${this.network}_${process.env.COMPOSE_PROJECT_NAME}`;
        await (0, rimraf_1.rimraf)(tempDir);
        this.logger.debug(`Creating temp dir: ${tempDir}`);
        await fs_1.promises.mkdir(tempDir, { recursive: true });
        for (let i = 0; i < this.config.validators; i++) {
            const res = await docker_compose_1.default.run(`${this.network}_val${i + 1}`, 'infinity', {
                config: this.filename,
                log: false,
                cwd: process.cwd(),
                commandOptions: ['--rm', '--entrypoint', 'sleep', '-d'],
            });
            this.logger.debug(res, `start container to run init stuff for validator ${i + 1}`);
            if (res.exitCode !== 0) {
                throw new Error(res.err);
            }
            this.containers[`${this.network}_val${i + 1}`] = res.out.trim();
        }
        //generate genesis
        await this.execInAllValidators((n) => `${this.config.binary} init val${this.network}${n} --chain-id=${this.config.chain_id} --home=/opt`);
        const validatorBalance = this.config.validators_balance;
        //add all validators keys and balances
        await Promise.all(new Array(this.config.validators).fill(0).map(async (_, i) => {
            await this.execInAllValidators(() => `echo "${mnemonic}" | ${this.config.binary} keys add val${i + 1} --home=/opt --recover --account=${i + 1} --keyring-backend=test`);
            await this.execInAllValidators(() => `${this.config.binary} add-genesis-account val${i + 1} ${Array.isArray(validatorBalance)
                ? validatorBalance[i]
                : validatorBalance}${this.config.denom} --home=/opt --keyring-backend=test`);
        }));
        //add wallets and their balances
        await Promise.all(Object.entries(wallets).map(async ([name, wallet]) => {
            await this.execInAllValidators(() => `echo "${wallet.mnemonic}" | ${this.config.binary} keys add ${name} --home=/opt --recover --keyring-backend=test`);
            await this.execInAllValidators(() => `${this.config.binary} add-genesis-account ${name} ${wallet.balance}${this.config.denom} --home=/opt --keyring-backend=test`);
        }));
        //gentx
        await this.execInAllValidators((n) => `${this.config.binary} gentx val${n + 1} ${Array.isArray(validatorBalance)
            ? validatorBalance[n]
            : validatorBalance}${this.config.denom} --home=/opt --keyring-backend=test --chain-id=${this.config.chain_id}`);
        //collect gentxs
        await this.execForAllValidatorsContainers(`cp $CONTAINER:/opt/config/gentx ${tempDir}/`);
        //collect peer ids
        const peerIds = (await this.execInAllValidators(() => `${this.config.binary} tendermint show-node-id --home=/opt`)).map((v) => `${v.res.out.trim()}@${v.key}:26656`);
        //compose genesis
        await (0, docker_cli_js_1.dockerCommand)(`cp ${tempDir}/gentx ${this.containers[`${this.network}_val1`]}:/opt/config/`);
        await this.execInValidator(`${this.network}_val1`, `${this.config.binary} collect-gentxs --home=/opt`);
        // retrieve configs
        await (0, docker_cli_js_1.dockerCommand)(`cp ${this.containers[`${this.network}_val1`]}:/opt/config/genesis.json ${tempDir}/___genesis.json.tmp`);
        await (0, docker_cli_js_1.dockerCommand)(`cp ${this.containers[`${this.network}_val1`]}:/opt/config/config.toml ${tempDir}/___config.toml.tmp`);
        await (0, docker_cli_js_1.dockerCommand)(`cp ${this.containers[`${this.network}_val1`]}:/opt/config/app.toml ${tempDir}/___app.toml.tmp`);
        //prepare configs
        this.logger.debug(`Preparing configs`);
        if (this.config.genesis_opts) {
            await this.prepareGenesis(`${tempDir}/___genesis.json.tmp`, this.config.genesis_opts);
        }
        await this.prepareTOML(`${tempDir}/___config.toml.tmp`, {
            'p2p.persistent_peers': peerIds.join(','),
            'rpc.laddr': 'tcp://0.0.0.0:26657',
            'api.address': 'tcp://0.0.0.0:1317',
            ...(this.config.config_opts || {}),
        });
        if (this.config.app_opts) {
            await this.prepareTOML(`${tempDir}/___app.toml.tmp`, this.config.app_opts);
        }
        //copy configs
        this.logger.debug(`Copying configs`);
        await this.execForAllValidatorsContainers(`cp ${tempDir}/___genesis.json.tmp $CONTAINER:/opt/config/genesis.json`);
        await this.execForAllValidatorsContainers(`cp ${tempDir}/___app.toml.tmp $CONTAINER:/opt/config/app.toml`);
        await this.execForAllValidatorsContainers(`cp ${tempDir}/___config.toml.tmp $CONTAINER:/opt/config/config.toml`);
        //upload files
        if (this.config.upload) {
            for (const path of this.config.upload) {
                await (0, docker_cli_js_1.dockerCommand)(`cp ${path} ${this.containers[`${this.network}_val1`]}:/opt/`);
            }
        }
        //exec post init commands
        if (this.config.post_init) {
            for (const command of this.config.post_init) {
                await this.execInValidator(`${this.network}_val1`, command);
            }
        }
        //stop all containers
        await this.execForAllValidatorsContainers('stop -t 0 $CONTAINER');
    }
    execForAllValidatorsContainers = async (command) => {
        const res = await Promise.all(Object.values(this.containers).map((container) => (0, docker_cli_js_1.dockerCommand)(command.replace('$CONTAINER', container), {
            echo: false,
        })));
        this.logger.debug(res, `exec result for all validators`);
        return res;
    };
    async prepareTOML(file, redefineOpts) {
        let data = toml_1.default.parse(await fs_1.promises.readFile(file, 'utf-8'));
        for (const [key, value] of Object.entries(redefineOpts)) {
            data = lodash_1.default.set(data, key, value);
        }
        await fs_1.promises.writeFile(file, toml_1.default.stringify(data));
    }
    async prepareGenesis(file, redefineOpts) {
        let data = JSON.parse(await fs_1.promises.readFile(file, 'utf-8'));
        for (const [key, value] of Object.entries(redefineOpts)) {
            data = lodash_1.default.set(data, key, value);
        }
        await fs_1.promises.writeFile(file, JSON.stringify(data, null, 2));
    }
    async stop() {
        this.logger.info(`Stopping default chain ${this.network}`);
        for (let i = 0; i < this.config.validators; i++) {
            const name = `${this.network}_val${i + 1}`;
            const res = await docker_compose_1.default.stopOne(name, {
                config: this.filename,
                cwd: process.cwd(),
                log: false,
            });
            this.logger.debug(res, `stop result for validator ${i + 1}`);
        }
    }
    async restart() {
        for (let i = 0; i < this.config.validators; i++) {
            const name = `${this.network}_val${i + 1}`;
            await docker_compose_1.default.restartOne(name, {
                config: this.filename,
                cwd: process.cwd(),
                log: true,
            });
        }
    }
    async execInAllValidators(command) {
        const validators = new Array(this.config.validators).fill(0);
        this.logger.debug(`Executing command in all validators: ${command}`);
        return await Promise.all(validators.map(async (_, i) => ({
            res: await this.execInValidator(`${this.network}_val${i + 1}`, command(i)),
            key: `${this.network}_val${i + 1}`,
        })));
    }
    async execInValidator(validator, command) {
        this.logger.debug(`Executing command in validator ${this.network} ${validator}: ${command}`);
        const res = await docker_compose_1.default.exec(validator, [`sh`, `-c`, command], {
            log: false,
            config: this.filename,
        });
        this.logger.debug(res, 'exec result');
        if (res.exitCode !== 0) {
            throw new Error(res.err);
        }
        return res;
    }
    async startValidator(n) {
        this.logger.info(`Starting validator ${n + 1}`);
        const res = await docker_compose_1.default.restartOne(`${this.network}_val${n + 1}`, {
            config: this.filename,
            cwd: process.cwd(),
            log: false,
        });
        this.logger.debug(res, 'restart result');
    }
    async stopValidator(n) {
        this.logger.info(`Stopping validator ${n + 1}`);
        const res = await docker_compose_1.default.stopOne(`${this.network}_val${n + 1}`, {
            config: this.filename,
            cwd: process.cwd(),
            log: false,
        });
        this.logger.debug(res, 'stop result');
    }
    static async create(name, config, wallets, mnemonic, filename) {
        const c = new CosmoparkDefaultChain(name, config, filename);
        await c.start(wallets, mnemonic);
        return c;
    }
    async execInSomewhere(command) {
        return await this.execInValidator(`${this.network}_val1`, command);
    }
}
exports.CosmoparkDefaultChain = CosmoparkDefaultChain;
