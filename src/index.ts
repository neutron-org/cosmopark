import toml from '@iarna/toml';
import { CosmoparkConfig } from './types';
import { Cosmopark } from './cosmopark';
import fs from 'fs';

const config: CosmoparkConfig = {
  networks: {
    gaia: {
      image: 'gaia',
      validators: 1,
      chain_id: 'ggg',
      denom: 'stake',
      binary: 'gaiad',
      prefix: 'cosmos',
      validators_balance: '1000000000',
      genesis_opts: {
        'app_state.slashing.params.downtime_jail_duration': '10s',
        'app_state.slashing.params.signed_blocks_window': '10',
      },
      config_opts: {
        'rpc.laddr': 'tcp://0.0.0.0:26657',
      },
      app_opts: {
        'api.enable': true,
        'rosetta.enable': true,
        'grpc.enable': true,
        'api.swagger': true,
        'minimum-gas-prices': '0stake',
        // 'rpc.laddr': 'tcp://0.0.0.0:26657',
      },
    },
    // gaia2: {
    //   image: 'gaia',
    //   validators: 1,
    //   chain_id: 'aaa',
    //   denom: 'stake',
    //   binary: 'gaiad',
    //   prefix: 'cosmos',
    //   validators_balance: '1000000000',
    //   genesis_opts: {
    //     // 'app_state.slashing.params.downtime_jail_duration': '10s',
    //     // 'app_state.slashing.params.signed_blocks_window': '10',
    //   },
    //   config_opts: {
    //     'rpc.laddr': 'tcp://0.0.0.0:26657',
    //   },
    //   app_opts: {
    //     'api.enable': true,
    //     'rosetta.enable': true,
    //     'grpc.enable': true,
    //     'api.swagger': true,
    //     'minimum-gas-prices': '0stake',
    //     // 'rpc.laddr': 'tcp://0.0.0.0:26657',
    //   },
    // },
    // lsm: {
    //   image: 'lsmi',
    //   validators: 4,
    //   chain_id: 'testlsm-1',
    //   denom: 'stake',
    //   binary: 'liquidstakingd',
    //   prefix: 'cosmos',
    //   validators_balance: '1000000000',
    //   // [
    //   //   '1000000000',
    //   //   '1000000000',
    //   //   '1000000000',
    //   //   '1000000000',
    //   // ], // or 1000000000
    //   genesis_opts: {
    //     'app_state.staking.params.validator_bond_factor': '10',
    //     'app_state.slashing.params.downtime_jail_duration': '10s',
    //     'app_state.slashing.params.signed_blocks_window': '10',
    //   },
    //   config_opts: {
    //     'rpc.laddr': 'tcp://0.0.0.0:26657',
    //   },
    //   app_opts: {
    //     'api.enable': 'true',
    //     'rosetta.enable': 'true',
    //     'grpc.enable': 'true',
    //     'api.swagger': 'true',
    //     // 'rpc.laddr': 'tcp://0.0.0.0:26657',
    //   },
    // },
    neutron: {
      image: 'neutron-node',
      binary: 'neutrond',
      chain_id: 'nnn',
      denom: 'untrn',
      prefix: 'neutron',
      type: 'ics',
      genesis_opts: {
        'app_state.crisis.constant_fee.denom': 'untrn',
      },
      config_opts: {
        'consensus.timeout_commit': '1s',
        'consensus.timeout_propose': '1s',
      },
      app_opts: {
        'api.enable': 'true',
        'rosetta.enable': 'true',
        'grpc.enable': 'true',
        'api.swagger': 'true',
        'minimum-gas-prices': '0.0025untrn',
        'telemetry.prometheus-retention-time': 1000,
      },
      upload: ['./contracts', './contracts_thirdparty', './init-neutrond.sh'],
      post_init: ['CHAINID=nnn CHAIN_DIR=/opt /opt/init-neutrond.sh'],
    },
  },
  relayers: [
    {
      type: 'hermes',
      networks: ['gaia', 'neutron'],
      connections: [['gaia', 'neutron']],
      log_level: 'info',
      image: 'hermes',
      binary: 'hermes',
      config: {},
      mnemonic:
        'laptop shy priority detect under sorry visit badge crew remind aware plate adapt eager taste',
      balance: '1000000000',
    },
    {
      type: 'neutron',
      networks: ['neutron', 'gaia'],
      image: 'neutron-org/neutron-query-relayer',
      log_level: 'info',
      binary: 'neutron-query-relayer',
      mnemonic:
        'ignore voyage dinner grit ramp list obvious couple crunch ability fork chef eight normal street fancy cycle hidden smile give tourist joy spin possible',
      balance: '1000000000',
    },
  ],
  master_mnemonic:
    'metal stay delay motion actor cave elite lend because cook sunset echo',
  wallets: {
    demowallet1: {
      mnemonic:
        'solve column paper kit clever electric laundry announce despair sister bring find bachelor enact two another tissue actor day punch orbit orbit math cave',
      balance: '1000000000',
    },
    demo1: {
      mnemonic:
        'banner spread envelope side kite person disagree path silver will brother under couch edit food venture squirrel civil budget number acquire point work mass',
      balance: '1000000000',
    },
    demo2: {
      mnemonic:
        'veteran try aware erosion drink dance decade comic dawn museum release episode original list ability owner size tuition surface ceiling depth seminar capable only',
      balance: '1000000000',
    },
  },
};

(async () => {
  const c = await Cosmopark.create(config);
  console.log(c);
})();

// const x = toml.parse(fs.readFileSync('./config.toml', 'utf-8'));
// console.log(JSON.stringify(x, null, 2));
const x = toml.stringify(config);
fs.writeFileSync('./config.toml', x);
// console.log(toml.parse(x));
// console.log(
//   JSON.stringify(
//     parse(fs.readFileSync('./docker-compose.yml', 'utf-8')),
//     null,
//     2,
//   ),
// );
