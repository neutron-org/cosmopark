"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmoparkHermesRelayer = void 0;
const docker_compose_1 = __importDefault(require("docker-compose"));
const docker_cli_js_1 = require("docker-cli-js");
const toml_1 = __importDefault(require("@iarna/toml"));
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const lodash_1 = __importDefault(require("lodash"));
const rimraf_1 = require("rimraf");
const ccvChainConfig = {
    id: '',
    rpc_addr: '',
    grpc_addr: '',
    websocket_addr: '',
    rpc_timeout: '10s',
    account_prefix: '',
    key_name: '',
    store_prefix: 'ibc',
    default_gas: 3000000,
    max_gas: 5000000,
    gas_price: {
        price: 0.005,
        denom: '',
    },
    gas_multiplier: 1.1,
    max_msg_num: 20,
    max_tx_size: 180000,
    clock_drift: '15s',
    max_block_time: '30s',
    trusting_period: '320hours',
    trust_threshold: {
        numerator: '1',
        denominator: '3',
    },
    address_type: { derivation: 'cosmos' },
    unbonding_period: '20days',
    packet_filter: {
        policy: 'allow',
        list: [['*', '*']],
    },
};
const standardChainConfig = {
    id: '',
    rpc_addr: '',
    grpc_addr: '',
    websocket_addr: '',
    rpc_timeout: '10s',
    account_prefix: '',
    key_name: '',
    store_prefix: 'ibc',
    default_gas: 5000000,
    max_gas: 15000000,
    gas_price: {
        price: 0.007,
        denom: '',
    },
    max_msg_num: 30,
    max_tx_size: 2097152,
    gas_multiplier: 1.1,
    clock_drift: '20s',
    max_block_time: '10s',
    trusting_period: '14days',
    unbonding_period: '504h0m0s',
    trust_threshold: {
        numerator: '1',
        denominator: '3',
    },
    address_type: { derivation: 'cosmos' },
    packet_filter: {
        policy: 'allow',
        list: [['*', '*']],
    },
};
const baseConfig = {
    global: {
        log_level: 'info',
    },
    mode: {
        clients: {
            enabled: true,
            refresh: true,
            misbehaviour: true,
        },
        connections: {
            enabled: true,
        },
        channels: {
            enabled: true,
        },
        packets: {
            enabled: true,
            clear_interval: 100,
            clear_on_start: true,
            tx_confirmation: true,
        },
    },
    rest: {
        enabled: true,
        host: '127.0.0.1',
        port: 3000,
    },
    telemetry: {
        enabled: true,
        host: '0.0.0.0',
        port: 3001,
    },
    chains: [],
};
class CosmoparkHermesRelayer {
    filename;
    name;
    container;
    config;
    networksConfig;
    debug = false;
    constructor(name, config, networksConfig, filename) {
        this.name = name;
        this.config = config;
        this.networksConfig = networksConfig;
        this.filename = filename;
    }
    async start() {
        const tempPath = `${os_1.default.tmpdir()}/cosmopark/${this.name}_${process.env.COMPOSE_PROJECT_NAME}`;
        await (0, rimraf_1.rimraf)(tempPath);
        await fs_1.promises.mkdir(tempPath, { recursive: true });
        const res = await docker_compose_1.default.run(this.name, 'infinity', {
            config: this.filename,
            log: this.debug,
            cwd: process.cwd(),
            commandOptions: ['--rm', '--entrypoint=sleep', '-d'],
        });
        this.container = res.out.trim();
        const config = this.prepareConfig();
        await fs_1.promises.writeFile(`${tempPath}/config.toml`, toml_1.default.stringify(config));
        await this.execInNode(`mkdir -p /root/.hermes`);
        await this.execForContainer(`cp ${tempPath}/config.toml $CONTAINER:/root/.hermes/config.toml`);
        await this.execInNode(`echo "${this.config.mnemonic}" > mnemonic.txt`);
        await Promise.all(this.config.networks.map((network) => this.execInNode(`${this.config.binary} keys add --key-name key-${network} --chain ${this.networksConfig[network].chain_id} --mnemonic-file mnemonic.txt`)));
        const starter = this.prepareStarter();
        await fs_1.promises.writeFile(`${tempPath}/start.sh`, starter, { mode: 0o755 });
        await this.execForContainer(`cp ${tempPath}/start.sh $CONTAINER:/root/start.sh`);
        await this.execForContainer(`stop $CONTAINER -t0`);
        await (0, rimraf_1.rimraf)(tempPath);
    }
    prepareConfig() {
        const config = lodash_1.default.cloneDeep(baseConfig);
        config.global.log_level = this.config.log_level;
        const networks = [];
        for (const network of this.config.networks) {
            networks.push({ key: network, config: this.networksConfig[network] });
        }
        for (const network of networks) {
            let chainConfig;
            let nodeKey;
            switch (network.config.type) {
                case 'ics':
                    chainConfig = lodash_1.default.cloneDeep(ccvChainConfig);
                    nodeKey = `${network.key}_ics`;
                    break;
                default:
                    chainConfig = lodash_1.default.cloneDeep(standardChainConfig);
                    nodeKey = `${network.key}_val1`;
            }
            chainConfig.id = network.config.chain_id;
            chainConfig.rpc_addr = `http://${nodeKey}:26657`;
            chainConfig.grpc_addr = `http://${nodeKey}:9090`;
            chainConfig.websocket_addr = `ws://${nodeKey}:26657/websocket`;
            chainConfig.account_prefix = network.config.prefix;
            chainConfig.key_name = `key-${network.key}`;
            chainConfig.gas_price.denom = network.config.denom;
            config.chains.push(chainConfig);
        }
        for (const [key, value] of Object.entries(this.config.config || {})) {
            lodash_1.default.set(config, key, value);
        }
        return config;
    }
    prepareStarter() {
        let out = `#!/bin/bash\n`;
        for (const [network1, network2] of this.config.connections || []) {
            out += `while ! echo "y" | ${this.config.binary} create channel --a-chain ${this.networksConfig[network1].chain_id} --b-chain ${this.networksConfig[network2].chain_id} --a-port transfer --b-port transfer --yes --new-client-connection; do
sleep 5
done
`;
        }
        out += 'hermes start';
        return out;
    }
    execForContainer(command) {
        return (0, docker_cli_js_1.dockerCommand)(command.replace('$CONTAINER', this.container), {
            echo: this.debug,
        });
    }
    execInNode(command) {
        return docker_compose_1.default.exec(this.name, [`sh`, `-c`, command], {
            config: this.filename,
            log: this.debug,
        });
    }
    static async create(name, config, networksConfig, filename) {
        const instance = new CosmoparkHermesRelayer(name, config, networksConfig, filename);
        await instance.start();
        return instance;
    }
}
exports.CosmoparkHermesRelayer = CosmoparkHermesRelayer;
