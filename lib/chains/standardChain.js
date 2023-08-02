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
class CosmoparkDefaultChain {
    type;
    network;
    config;
    relayers = [];
    containers = {};
    debug = false;
    constructor(name, config) {
        this.type = config.type;
        this.config = config;
        this.network = name;
    }
    async start(wallets, mnemonic) {
        const tempDir = `${os_1.default.tmpdir()}/cosmopark/${this.network}`;
        await (0, rimraf_1.rimraf)(tempDir);
        await fs_1.promises.mkdir(tempDir, { recursive: true });
        for (let i = 0; i < this.config.validators; i++) {
            const res = await docker_compose_1.default.run(`${this.network}_val${i + 1}`, 'infinity', {
                log: this.debug,
                cwd: process.cwd(),
                commandOptions: ['--rm', '--entrypoint', 'sleep', '-d'],
            });
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
        await Promise.all([
            (0, docker_cli_js_1.dockerCommand)(`cp ${this.containers[`${this.network}_val1`]}:/opt/config/genesis.json ${tempDir}/___genesis.json.tmp`),
            (0, docker_cli_js_1.dockerCommand)(`cp ${this.containers[`${this.network}_val1`]}:/opt/config/config.toml ${tempDir}/___config.toml.tmp`),
            (0, docker_cli_js_1.dockerCommand)(`cp ${this.containers[`${this.network}_val1`]}:/opt/config/app.toml ${tempDir}/___app.toml.tmp`),
        ]);
        //prepare configs
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
        await Promise.all([
            this.execForAllValidatorsContainers(`cp ${tempDir}/___genesis.json.tmp $CONTAINER:/opt/config/genesis.json`),
            this.execForAllValidatorsContainers(`cp ${tempDir}/___app.toml.tmp $CONTAINER:/opt/config/app.toml`),
            this.execForAllValidatorsContainers(`cp ${tempDir}/___config.toml.tmp $CONTAINER:/opt/config/config.toml`),
        ]);
        //stop all containers
        await this.execForAllValidatorsContainers('stop -t 0 $CONTAINER');
    }
    async execForAllValidatorsContainers(command) {
        return Object.values(this.containers).map((container) => (0, docker_cli_js_1.dockerCommand)(command.replace('$CONTAINER', container), {
            echo: this.debug,
        }));
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
                cwd: process.cwd(),
                log: this.debug,
            });
        }
    }
    async restart() {
        for (let i = 0; i < this.config.validators; i++) {
            const name = `${this.network}_val${i + 1}`;
            await docker_compose_1.default.restartOne(name, {
                cwd: process.cwd(),
                log: true,
            });
        }
    }
    async execInAllValidators(command) {
        const validators = new Array(this.config.validators).fill(0);
        return Promise.all(validators.map(async (_, i) => ({
            res: await this.execInValidator(`${this.network}_val${i + 1}`, command(i)),
            key: `${this.network}_val${i + 1}`,
        })));
    }
    async execInValidator(validator, command) {
        const res = await docker_compose_1.default.exec(validator, [`sh`, `-c`, command], {
            log: this.debug,
        });
        if (res.exitCode !== 0) {
            throw new Error(res.err);
        }
        return res;
    }
    async startValidator(n) {
        console.log('startValidator', n);
    }
    async stopValidator(n) {
        console.log('stopValidator', n);
    }
    static async create(name, config, wallets, mnemonic) {
        const c = new CosmoparkDefaultChain(name, config);
        await c.start(wallets, mnemonic);
        return c;
    }
}
exports.CosmoparkDefaultChain = CosmoparkDefaultChain;
