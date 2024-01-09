"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cosmopark = void 0;
const yaml_1 = __importDefault(require("yaml"));
const fs_1 = __importDefault(require("fs"));
const docker_compose_1 = __importDefault(require("docker-compose"));
const docker_cli_js_1 = require("docker-cli-js");
const pino_1 = __importDefault(require("pino"));
const icsChain_1 = require("./chains/icsChain");
const standardChain_1 = require("./chains/standardChain");
const hermes_1 = require("./relayers/hermes");
const logger_1 = require("./logger");
const mutex_1 = require("./mutex");
class Cosmopark {
    context;
    filename;
    logLevel = 'info';
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
        logger_1.logger.level = config.loglevel;
        const logContext = logger_1.logger.child({ context: 'main' });
        logContext.debug('start cosmopark');
        const ver = await docker_compose_1.default.version();
        logContext.debug({ ver }, 'docker-compose version');
        if (ver.exitCode !== 0 || !ver.data.version.match(/^[2-9]/gi)) {
            logContext.error(`Docker compose version should be 2 or higher, found ${ver.data.version}`);
            throw new Error(`Docker compose version should be 2 or higher, found ${ver.data.version}`);
        }
        logContext.debug('docker-compose version is ok');
        const counter = await (0, mutex_1.getMutexCounter)();
        logContext.debug({ counter }, 'counter of instances');
        const instance = new Cosmopark({ portOffset: counter * 100, ...config });
        if (fs_1.default.existsSync(instance.filename)) {
            instance.validateConfig(config);
            logContext.debug('config is valid');
            try {
                const res = await docker_compose_1.default.down({
                    config: instance.filename,
                    cwd: process.cwd(),
                    log: false,
                    commandOptions: ['-v', '--remove-orphans'],
                });
                logContext.debug({ res }, 'docker-compose down');
            }
            catch (e) {
                logContext.error({ e }, 'docker-compose down error');
                const res = await docker_compose_1.default.ps({ commandOptions: ['-a'] });
                logContext.debug({ res }, 'docker-compose ps');
                if (res.exitCode === 0) {
                    const containers = res.out
                        .split('\n')
                        .filter((v) => v.match(/cosmopark_/))
                        .map((v) => v.split(' ')[0]);
                    logContext.debug({ containers }, 'containers to stop');
                    await (0, docker_cli_js_1.dockerCommand)(`stop -t0 ${containers.join(' ')}`);
                    logContext.debug('containers stopped');
                    const downRes = await docker_compose_1.default.down({
                        cwd: process.cwd(),
                        log: false,
                        commandOptions: ['-v', '--remove-orphans'],
                    });
                    logContext.debug(downRes, 'docker-compose down');
                }
                else {
                    logContext.error({ e }, 'docker-compose ps error');
                    throw e;
                }
            }
        }
        logContext.debug('generate docker-compose yaml file');
        await instance.generateDockerCompose();
        logContext.debug('docker-compose yaml file generated');
        const relayerWallets = config.relayers
            ?.map((relayer) => ({
            mnemonic: relayer.mnemonic,
            balance: relayer.balance,
        }))
            .reduce((a, c, idx) => ({ ...a, [`relayer_${idx}`]: c }), {}) || {};
        for (const [key, network] of Object.entries(config.networks)) {
            switch (network.type) {
                case 'ics':
                    logContext.debug('create ics chain');
                    instance.networks[key] = await icsChain_1.CosmoparkIcsChain.create(key, network, { ...config.wallets, ...relayerWallets }, instance.filename);
                    break;
                default:
                    logContext.debug('create default chain');
                    instance.networks[key] = await standardChain_1.CosmoparkDefaultChain.create(key, network, { ...config.wallets, ...relayerWallets }, config.master_mnemonic, instance.filename);
                    break;
            }
        }
        for (const [index, relayer] of Object.entries(config.relayers || [])) {
            switch (relayer.type) {
                case 'hermes':
                    logContext.debug('create hermes relayer');
                    instance.relayers.push(await hermes_1.CosmoparkHermesRelayer.create(`relayer_${relayer.type}${index}`, relayer, config.networks, instance.filename));
                    break;
                case 'neutron':
                    // nothing to do here
                    break;
                default:
                    throw new Error(`Relayer type ${relayer.type} is not supported`);
            }
        }
        logContext.debug('docker-compose up');
        const resUp = await docker_compose_1.default.upAll({
            config: instance.filename,
            cwd: process.cwd(),
            log: false,
        });
        logContext.debug({ resUp }, 'docker-compose up result');
        if (config.awaitFirstBlock) {
            logContext.debug('await first block');
            await instance.awaitFirstBlock();
            logContext.debug('first block received');
        }
        for (const [chainName, chainInstance] of Object.entries(instance.networks)) {
            if (config.networks[chainName].post_start) {
                for (const command of config.networks[chainName].post_start) {
                    await chainInstance.execInSomewhere(command);
                }
            }
        }
        return instance;
    }
    awaitFirstBlock = async () => {
        const timeout = 1000 * 30;
        const start = Date.now();
        logger_1.logger.debug('await first block');
        while (Date.now() - start < timeout) {
            try {
                const all = await Promise.all(Object.entries(this.ports).map(async ([, ports]) => {
                    try {
                        const res = await fetch(`http://127.0.0.1:${ports.rpc}/status`);
                        const json = await res.json();
                        logger_1.logger.debug(json, 'await first block res ok');
                        return Number(json.result.sync_info.latest_block_height) > 0;
                    }
                    catch (e) {
                        logger_1.logger.debug(e, 'await first block error');
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
        logger_1.logger.error('timeout waiting for first block');
        throw new Error(`Timeout waiting for first block`);
    };
    async pauseRelayer(type, index) {
        await docker_compose_1.default.pauseOne(`relayer_${type}${index}`);
    }
    async resumeRelayer(type, index) {
        await docker_compose_1.default.unpauseOne(`relayer_${type}${index}`);
    }
    async restartRelayer(type, index) {
        await docker_compose_1.default.restartOne(`relayer_${type}${index}`);
    }
    async pauseNetwork(network) {
        if (this.networks[network].type === 'ics') {
            await docker_compose_1.default.pauseOne(`${network}_ics`);
        }
        else {
            for (let i = 0; i++; i < this.networks[network].config.validators) {
                await docker_compose_1.default.pauseOne(`${network}_val${i + 1}`);
            }
        }
    }
    executeInNetwork = async (network, command) => this.networks[network].execInSomewhere(command);
    stop = async () => {
        await docker_compose_1.default.down({
            config: this.filename,
            cwd: process.cwd(),
            log: false,
            commandOptions: ['-v', '--remove-orphans', '-t0'],
        });
        await (0, mutex_1.releaseMutex)();
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
                        services[name] = {
                            image: network.image,
                            command: [
                                'start',
                                `--home=/opt`,
                                `--pruning=nothing`,
                                `--log_format=json`,
                                `--log_level=${network.loglevel || 'info'}`,
                                ...(network.trace ? ['--trace'] : []),
                            ],
                            entrypoint: [network.binary],
                            volumes: [`${name}:/opt`],
                            ports: [
                                `${rpcPort}:26657`,
                                `${restPort}:1317`,
                                `${grpcPort}:9090`,
                            ],
                        };
                        volumes[name] = null;
                    }
                    break;
                default:
                    for (let i = 0; i < network.validators; i++) {
                        const name = `${key}_val${i + 1}`;
                        services[name] = {
                            image: network.image,
                            command: [
                                'start',
                                `--home=/opt`,
                                `--log_level=debug`,
                                `--pruning=nothing`,
                                `--log_format=${network.loglevel || 'info'}`,
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
        if (config.loglevel &&
            !Object.values(pino_1.default.levels.labels).includes(config.loglevel)) {
            throw new Error(`Log level should be one of ${Object.values(pino_1.default.levels.labels).join(', ')}`);
        }
        else {
            config.loglevel = 'info';
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
