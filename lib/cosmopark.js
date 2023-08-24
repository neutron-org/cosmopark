"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cosmopark = void 0;
const yaml_1 = __importDefault(require("yaml"));
const fs_1 = __importDefault(require("fs"));
const standardChain_1 = require("./chains/standardChain");
const docker_compose_1 = __importDefault(require("docker-compose"));
const icsChain_1 = require("./chains/icsChain");
const hermes_1 = require("./relayers/hermes");
const docker_cli_js_1 = require("docker-cli-js");
const TMP_FILE = '.__cosmopark';
class Cosmopark {
    debug = false;
    context;
    filename;
    ports = {};
    config;
    networks = {};
    relayers = []; //TODO: add relayers type
    constructor(config) {
        this.config = config;
        this.context = config.context || 'cosmopark';
        process.env.COMPOSE_PROJECT_NAME = this.context;
        this.filename = config.context
            ? `docker-compose-${config.context}.yml`
            : 'docker-compose.yml';
    }
    static async create(config) {
        let counter = 0;
        if (config.multicontext && fs_1.default.existsSync(TMP_FILE)) {
            counter = Number(fs_1.default.readFileSync(TMP_FILE, 'utf-8'));
        }
        config.multicontext && fs_1.default.writeFileSync(TMP_FILE, `${counter + 1}`);
        const instance = new Cosmopark({ portOffset: counter * 100, ...config });
        if (fs_1.default.existsSync(instance.filename)) {
            instance.validateConfig(config);
            try {
                await docker_compose_1.default.down({
                    config: instance.filename,
                    cwd: process.cwd(),
                    log: false,
                    commandOptions: ['-v', '--remove-orphans'],
                });
            }
            catch (e) {
                const res = await docker_compose_1.default.ps({ commandOptions: ['-a'] });
                if (res.exitCode === 0) {
                    const containers = res.out
                        .split('\n')
                        .filter((v) => v.match(/cosmopark_/))
                        .map((v) => v.split(' ')[0]);
                    await (0, docker_cli_js_1.dockerCommand)(`stop -t0 ${containers.join(' ')}`);
                    await docker_compose_1.default.down({
                        cwd: process.cwd(),
                        log: false,
                        commandOptions: ['-v', '--remove-orphans'],
                    });
                }
                else {
                    throw e;
                }
            }
        }
        await instance.generateDockerCompose();
        const relayerWallets = config.relayers
            ?.map((relayer) => ({
            mnemonic: relayer.mnemonic,
            balance: relayer.balance,
        }))
            .reduce((a, c, idx) => ({ ...a, [`relayer_${idx}`]: c }), {}) || {};
        for (const [key, network] of Object.entries(config.networks)) {
            switch (network.type) {
                case 'ics':
                    instance.networks[key] = await icsChain_1.CosmoparkIcsChain.create(key, network, { ...config.wallets, ...relayerWallets }, instance.filename);
                    break;
                default:
                    instance.networks[key] = await standardChain_1.CosmoparkDefaultChain.create(key, network, { ...config.wallets, ...relayerWallets }, config.master_mnemonic, instance.filename);
                    break;
            }
        }
        for (const [index, relayer] of Object.entries(config.relayers || [])) {
            switch (relayer.type) {
                case 'hermes':
                    instance.relayers.push(await hermes_1.CosmoparkHermesRelayer.create(`relayer_${relayer.type}${index}`, relayer, config.networks, instance.filename));
                    break;
                case 'neutron':
                    // nothing to do here
                    break;
                default:
                    throw new Error(`Relayer type ${relayer.type} is not supported`);
            }
        }
        await docker_compose_1.default.upAll({
            config: instance.filename,
            cwd: process.cwd(),
            log: instance.debug,
        });
        if (config.awaitFirstBlock) {
            await instance.awaitFirstBlock();
        }
        for (const [chainName, chainInstance] of Object.entries(instance.networks)) {
            if (config.networks[chainName].post_start) {
                for (const command of config.networks[chainName].post_start) {
                    await chainInstance.execInSomewhere(command);
                }
            }
        }
        console.log('done waiting');
        return instance;
    }
    awaitFirstBlock = async () => {
        const timeout = 1000 * 30;
        const start = Date.now();
        while (Date.now() - start < timeout) {
            try {
                const all = await Promise.all(Object.entries(this.ports).map(async ([, ports]) => {
                    try {
                        const res = await fetch(`http://127.0.0.1:${ports.rpc}/status`);
                        const json = await res.json();
                        return Number(json.result.sync_info.latest_block_height) > 0;
                    }
                    catch (e) {
                        return false;
                    }
                }));
                if (all.every((v) => v)) {
                    return;
                }
            }
            catch (e) {
                //noop
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error(`Timeout waiting for first block`);
    };
    stop = async () => {
        await docker_compose_1.default.down({
            config: this.filename,
            cwd: process.cwd(),
            log: this.debug,
            commandOptions: ['-v', '--remove-orphans', '-t0'],
        });
        if (this.config.multicontext && fs_1.default.existsSync(TMP_FILE)) {
            let counter = Number(fs_1.default.readFileSync(TMP_FILE, 'utf-8'));
            counter--;
            if (counter) {
                fs_1.default.writeFileSync(TMP_FILE, `${counter}`);
            }
            else {
                fs_1.default.unlinkSync(TMP_FILE);
            }
        }
    };
    async generateDockerCompose() {
        const services = {};
        const volumes = {};
        let networkCounter = 0;
        const portOffset = this.config.portOffset || 0;
        for (const [key, network] of Object.entries(this.config.networks)) {
            const rpcPort = portOffset + networkCounter + 26657;
            const restPort = portOffset + networkCounter + 1317;
            const grpcPort = portOffset + networkCounter + 9090;
            this.ports[key] = {
                rpc: rpcPort,
                rest: restPort,
                grpc: grpcPort,
            };
            switch (network.type) {
                case 'ics':
                    {
                        const name = `${key}_ics`;
                        const logLevel = network.loglevel ? 'debug' : 'info';
                        services[name] = {
                            image: network.image,
                            command: [
                                'start',
                                `--home=/opt`,
                                `--pruning=nothing`,
                                `--log_format=json`,
                                `--log_level=${logLevel}`,
                                ...(network.trace ? ['--trace'] : []),
                            ],
                            entrypoint: [network.binary],
                            volumes: [`${name}:/opt`],
                            ports: [
                                `127.0.0.1:${rpcPort}:26657`,
                                `127.0.0.1:${restPort}:1317`,
                                `127.0.0.1:${grpcPort}:9090`,
                            ],
                        };
                        volumes[name] = null;
                    }
                    break;
                default:
                    for (let i = 0; i < network.validators; i++) {
                        const name = `${key}_val${i + 1}`;
                        const logLevel = network.loglevel ? 'debug' : 'info';
                        services[name] = {
                            image: network.image,
                            command: [
                                'start',
                                `--home=/opt`,
                                `--log_level=debug`,
                                `--pruning=nothing`,
                                `--log_format=${logLevel}`,
                                ...(network.trace ? ['--trace'] : []),
                            ],
                            entrypoint: [network.binary],
                            volumes: [`${name}:/opt`],
                            ...(i === 0 && {
                                ports: [
                                    `127.0.0.1:${portOffset + networkCounter + 26657}:26657`,
                                    `127.0.0.1:${portOffset + networkCounter + 1317}:1317`,
                                    `127.0.0.1:${portOffset + networkCounter + 9090}:9090`,
                                ],
                            }),
                        };
                        volumes[name] = null;
                    }
            }
            networkCounter++;
        }
        const prevConnections = [];
        for (const [index, relayer] of Object.entries(this.config.relayers || [])) {
            const name = `relayer_${relayer.type}${index}`;
            switch (relayer.type) {
                case 'hermes':
                    services[name] = {
                        image: relayer.image,
                        command: ['-c', `/root/start.sh`],
                        volumes: [`${name}:/root`],
                        entrypoint: ['/bin/bash'],
                        depends_on: relayer.networks.map((network) => `${network}${this.config.networks[network].type === 'ics'
                            ? '_ics'
                            : '_val1'}`),
                    };
                    volumes[name] = null;
                    prevConnections.push(...(relayer.connections || []));
                    break;
                case 'neutron': {
                    let id = 0;
                    const icsNetwork = relayer.networks.find((network) => this.config.networks[network].type === 'ics');
                    const otherNetwork = relayer.networks.find((network) => this.config.networks[network].type !== 'ics');
                    for (const [network1, network2] of prevConnections) {
                        if ((network1 === icsNetwork && network2 === otherNetwork) ||
                            (network2 === icsNetwork && network1 === otherNetwork)) {
                            break;
                        }
                        if (network1 === icsNetwork || network2 === icsNetwork) {
                            id++;
                        }
                    }
                    if (!icsNetwork || !otherNetwork) {
                        throw new Error(`Relayer:${relayer.type} should be linked to 2 networks (1 ics and 1 default)`);
                    }
                    services[name] = {
                        image: relayer.image,
                        entrypoint: ['./run.sh'],
                        depends_on: relayer.networks.map((network) => `${network}${this.config.networks[network].type === 'ics'
                            ? '_ics'
                            : '_val1'}`),
                        volumes: [`${icsNetwork}_ics:/data`],
                        environment: [
                            `NODE=${icsNetwork}_ics`,
                            `LOGGER_LEVEL=${relayer.log_level}`,
                            `RELAYER_NEUTRON_CHAIN_CHAIN_PREFIX=${this.config.networks[icsNetwork].prefix}`,
                            `RELAYER_NEUTRON_CHAIN_RPC_ADDR=tcp://${icsNetwork}_ics:26657`,
                            `RELAYER_NEUTRON_CHAIN_REST_ADDR=http://${icsNetwork}_ics:1317`,
                            `RELAYER_NEUTRON_CHAIN_HOME_DIR=/data`,
                            `RELAYER_NEUTRON_CHAIN_SIGN_KEY_NAME=relayer_${index}`,
                            `RELAYER_NEUTRON_CHAIN_GAS_PRICES=0.5${this.config.networks[icsNetwork].denom}`,
                            `RELAYER_NEUTRON_CHAIN_GAS_ADJUSTMENT=1.5`,
                            `RELAYER_NEUTRON_CHAIN_CONNECTION_ID=connection-${id}`,
                            `RELAYER_NEUTRON_CHAIN_DEBUG=true`,
                            `RELAYER_NEUTRON_CHAIN_ACCOUNT_PREFIX=${this.config.networks[icsNetwork].prefix}`,
                            `RELAYER_NEUTRON_CHAIN_KEYRING_BACKEND=test`,
                            `RELAYER_TARGET_CHAIN_RPC_ADDR=tcp://${otherNetwork}_val1:26657`,
                            `RELAYER_TARGET_CHAIN_ACCOUNT_PREFIX=${this.config.networks[otherNetwork].prefix}`,
                            `RELAYER_TARGET_CHAIN_VALIDATOR_ACCOUNT_PREFIX=${this.config.networks[otherNetwork].prefix}valoper`,
                            `RELAYER_TARGET_CHAIN_DEBUG=true`,
                            `RELAYER_REGISTRY_ADDRESSES=`,
                            `RELAYER_ALLOW_TX_QUERIES=true`,
                            `RELAYER_ALLOW_KV_CALLBACKS=true`,
                            `RELAYER_STORAGE_PATH=/data/relayer/storage/leveldb`,
                            `RELAYER_LISTEN_ADDR=0.0.0.0:9999`,
                        ],
                    };
                }
            }
        }
        const dockerCompose = {
            version: '3',
            services,
            volumes,
        };
        fs_1.default.writeFileSync(this.filename, yaml_1.default.stringify(dockerCompose, { indent: 2 }));
    }
    validateConfig = (config) => {
        const networks = new Set(Object.keys(config.networks));
        const relayers = config.relayers || [];
        if (config.context && !config.context.match(/^[a-z0-9]+$/)) {
            throw new Error(`Context should be lowercase alphanumeric`);
        }
        if (config.portOffset && !Number.isFinite(config.portOffset)) {
            throw new Error(`Port offset should be number`);
        }
        for (const [key, network] of Object.entries(config.networks)) {
            if (network.type !== 'ics') {
                if (!network.validators_balance) {
                    throw new Error(`Network:${key} does not have validators_balance`);
                }
                if (Array.isArray(network.validators_balance)) {
                    if (network.validators_balance.length !== network.validators) {
                        throw new Error(`Network:${key} does not have validators_balance for all validators`);
                    }
                }
                else {
                    if (typeof network.validators_balance !== 'string' ||
                        !network.validators_balance.match(/^[0-9]+$/)) {
                        throw new Error(`Network:${key} validators_balance if wrong type`);
                    }
                }
                if (!network.validators) {
                    throw new Error(`Network:${key} does not have validators number`);
                }
            }
        }
        for (const relayer of relayers) {
            for (const network of relayer.networks) {
                if (!networks.has(network)) {
                    throw new Error(`Relayer is linked to the network:${network} is not defined`);
                }
            }
            if (relayer.type === 'neutron') {
                if (relayer.networks.length !== 2) {
                    throw new Error(`Relayer:${relayer.type} should be linked to 2 networks`);
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
exports.Cosmopark = Cosmopark;
