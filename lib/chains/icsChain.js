"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmoparkIcsChain = void 0;
const docker_compose_1 = __importDefault(require("docker-compose"));
const docker_cli_js_1 = require("docker-cli-js");
const rimraf_1 = require("rimraf");
const toml_1 = __importDefault(require("@iarna/toml"));
const fs_1 = require("fs");
const lodash_1 = __importDefault(require("lodash"));
const os_1 = __importDefault(require("os"));
const logger_1 = require("../logger");
class CosmoparkIcsChain {
    type;
    network;
    config;
    relayers = [];
    filename;
    container;
    logger;
    commands = {
        init: 'init',
        keysAdd: 'keys add',
        addGenesisAccount: 'add-genesis-account',
        addConsumerSection: 'add-consumer-section',
        unsafeResetAll: 'tendermint unsafe-reset-all',
    };
    constructor(name, config, filename) {
        this.type = config.type;
        this.config = config;
        this.network = name;
        this.filename = filename;
        this.logger = logger_1.logger.child({ chain: this.network });
        this.commands = {
            ...this.commands,
            ...config.commands,
        };
    }
    async start(wallets) {
        this.logger.info(`Starting ics chain ${this.network}`);
        const tempDir = `${os_1.default.tmpdir()}/cosmopark/${this.network}_${process.env.COMPOSE_PROJECT_NAME}`;
        this.logger.debug(`Removing temp dir: ${tempDir}`);
        await (0, rimraf_1.rimraf)(tempDir);
        this.logger.debug(`Creating temp dir: ${tempDir}`);
        try {
            await fs_1.promises.mkdir(tempDir, { recursive: true });
        }
        catch (e) {
            // noop
        }
        const res = await docker_compose_1.default.run(`${this.network}_ics`, 'infinity', {
            config: this.filename,
            log: false,
            cwd: process.cwd(),
            commandOptions: ['--rm', '--entrypoint=sleep', '-d'],
        });
        this.logger.debug(res, 'start container to run init stuff');
        this.container = res.out.trim();
        //generate genesis
        await this.execInNode(`${this.config.binary} ${this.commands.init} ${this.network} --chain-id=${this.config.chain_id} --home=/opt`);
        this.logger.debug(`Creating wallets for ${this.network}`);
        //add wallets and their balances
        for (const [name, wallet] of Object.entries(wallets)) {
            await this.execInNode(`echo "${wallet.mnemonic}" | ${this.config.binary} ${this.commands.keysAdd} ${name} --home=/opt --recover --keyring-backend=test`);
            await this.execInNode(`${this.config.binary} ${this.commands.addGenesisAccount} ${name} ${wallet.balance}${this.config.denom} --home=/opt --keyring-backend=test`);
        }
        this.logger.debug(`Copying configs from container ${this.container}`);
        await this.execForContainer(`cp $CONTAINER:/opt/config/genesis.json ${tempDir}/___genesis.json.tmp`);
        await this.execForContainer(`cp $CONTAINER:/opt/config/config.toml ${tempDir}/___config.toml.tmp`);
        await this.execForContainer(`cp $CONTAINER:/opt/config/app.toml ${tempDir}/___app.toml.tmp`);
        //prepare configs
        this.logger.debug(`Preparing configs`);
        if (this.config.genesis_opts) {
            await this.prepareGenesis(`${tempDir}/___genesis.json.tmp`, this.config.genesis_opts);
        }
        await this.prepareTOML(`${tempDir}/___config.toml.tmp`, {
            'rpc.laddr': 'tcp://0.0.0.0:26657',
            'api.address': 'tcp://0.0.0.0:1317',
            ...(this.config.config_opts || {}),
        });
        if (this.config.app_opts) {
            await this.prepareTOML(`${tempDir}/___app.toml.tmp`, this.config.app_opts);
        }
        //copy configs
        this.logger.debug(`Copying configs to container ${this.container}`);
        await this.execForContainer(`cp ${tempDir}/___genesis.json.tmp $CONTAINER:/opt/config/genesis.json`);
        await this.execForContainer(`cp ${tempDir}/___app.toml.tmp $CONTAINER:/opt/config/app.toml`);
        await this.execForContainer(`cp ${tempDir}/___config.toml.tmp $CONTAINER:/opt/config/config.toml`);
        this.logger.debug(`unsafe-reset-all`);
        await this.execInNode(`${this.config.binary} ${this.commands.unsafeResetAll} --home=/opt`);
        this.logger.debug(`add-consumer-section`);
        await this.execInNode(`${this.config.binary} ${this.commands.addConsumerSection} --home=/opt`);
        //upload files
        if (this.config.upload) {
            await Promise.all(this.config.upload.map(async (path) => {
                await this.execForContainer(`cp ${path} $CONTAINER:/opt/`);
            }));
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
    async execForContainer(command) {
        this.logger.debug(`Executing command in container ${this.container}: ${command}`);
        const out = await (0, docker_cli_js_1.dockerCommand)(command.replace('$CONTAINER', this.container), {
            echo: false,
        });
        this.logger.debug(out, 'exec result');
        return out;
    }
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
        for (let i = 0; i < this.config.validators; i++) {
            const name = `${this.network}_val${i + 1}`;
            const res = await docker_compose_1.default.stopOne(name, {
                config: this.filename,
                cwd: process.cwd(),
                log: false,
            });
            this.logger.debug(res, 'stop result');
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
    async execInNode(command) {
        this.logger.debug(`Executing command in node ${this.network} ${this.network}_ics: ${command}`);
        const res = await docker_compose_1.default.exec(`${this.network}_ics`, [`sh`, `-c`, command], {
            log: false,
            config: this.filename,
        });
        this.logger.debug(res, 'exec result');
        if (res.exitCode !== 0) {
            this.logger.error(res.out);
            throw new Error(res.out);
        }
        return res;
    }
    // eslint-disable-next-line require-await
    async startValidator() {
        throw new Error('No validators in ics chain');
    }
    // eslint-disable-next-line require-await
    async stopValidator() {
        throw new Error('No validators in ics chain');
    }
    static async create(name, config, wallets, filename) {
        const c = new CosmoparkIcsChain(name, config, filename);
        await c.start(wallets);
        return c;
    }
    async execInSomewhere(command) {
        return await this.execInNode(command);
    }
}
exports.CosmoparkIcsChain = CosmoparkIcsChain;
