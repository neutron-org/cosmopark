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
class CosmoparkIcsChain {
    type;
    network;
    config;
    relayers = [];
    filename;
    container;
    debug = false;
    constructor(name, config, filename) {
        this.type = config.type;
        this.config = config;
        this.network = name;
        this.filename = filename;
    }
    async start(wallets) {
        const tempDir = `${os_1.default.tmpdir()}/cosmopark/${this.network}`;
        await (0, rimraf_1.rimraf)(tempDir);
        await fs_1.promises.mkdir(tempDir, { recursive: true });
        const res = await docker_compose_1.default.run(`${this.network}_ics`, 'infinity', {
            config: this.filename,
            log: this.debug,
            cwd: process.cwd(),
            commandOptions: ['--rm', '--entrypoint=sleep', '-d'],
        });
        this.container = res.out.trim();
        //generate genesis
        await this.execInNode(`${this.config.binary} init ${this.network} --chain-id=${this.config.chain_id} --home=/opt`);
        if (this.debug) {
            console.log(`Adding wallets to genesis ${this.network}`, wallets);
        }
        //add wallets and their balances
        await Promise.all(Object.entries(wallets).map(async ([name, wallet]) => {
            await this.execInNode(`echo "${wallet.mnemonic}" | ${this.config.binary} keys add ${name} --home=/opt --recover --keyring-backend=test`);
            await this.execInNode(`${this.config.binary} add-genesis-account ${name} ${wallet.balance}${this.config.denom} --home=/opt --keyring-backend=test`);
        }));
        await Promise.all([
            this.execForContainer(`cp $CONTAINER:/opt/config/genesis.json ${tempDir}/___genesis.json.tmp`),
            this.execForContainer(`cp $CONTAINER:/opt/config/config.toml ${tempDir}/___config.toml.tmp`),
            this.execForContainer(`cp $CONTAINER:/opt/config/app.toml ${tempDir}/___app.toml.tmp`),
        ]);
        //prepare configs
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
        await Promise.all([
            this.execForContainer(`cp ${tempDir}/___genesis.json.tmp $CONTAINER:/opt/config/genesis.json`),
            this.execForContainer(`cp ${tempDir}/___app.toml.tmp $CONTAINER:/opt/config/app.toml`),
            this.execForContainer(`cp ${tempDir}/___config.toml.tmp $CONTAINER:/opt/config/config.toml`),
        ]);
        await this.execInNode(`${this.config.binary} tendermint unsafe-reset-all --home=/opt`);
        await this.execInNode(`${this.config.binary} add-consumer-section --home=/opt`);
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
        if (this.debug) {
            console.log(`Executing command in container ${this.container}: ${command}`);
        }
        return (0, docker_cli_js_1.dockerCommand)(command.replace('$CONTAINER', this.container), {
            echo: this.debug,
        });
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
            await docker_compose_1.default.stopOne(name, {
                config: this.filename,
                cwd: process.cwd(),
                log: this.debug,
            });
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
        if (this.debug) {
            console.log(`Executing command in node ${this.network} ${this.network}_ics: ${command}`);
        }
        const res = await docker_compose_1.default.exec(`${this.network}_ics`, [`sh`, `-c`, command], {
            log: this.debug,
            config: this.filename,
        });
        if (res.exitCode !== 0) {
            throw new Error(res.out);
        }
        return res;
    }
    async startValidator() {
        throw new Error('No validators in ics chain');
    }
    async stopValidator() {
        throw new Error('No validators in ics chain');
    }
    static async create(name, config, wallets, filename) {
        const c = new CosmoparkIcsChain(name, config, filename);
        await c.start(wallets);
        return c;
    }
}
exports.CosmoparkIcsChain = CosmoparkIcsChain;
