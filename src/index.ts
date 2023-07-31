// import toml from '@iarna/toml';
import { CosmoparkConfig } from './types';
import { Cosmopark } from './cosmopark';

const config: CosmoparkConfig = {
  networks: {
    lsm: {
      image: 'lsm',
      validators: 4,
      chain_id: 'testlsm',
      denom: 'stake',
      binary: 'liquidstakingd',
      prefix: 'cosmos',
      validators_balance: '1000000000',
      // [
      //   '1000000000',
      //   '1000000000',
      //   '1000000000',
      //   '1000000000',
      // ], // or 1000000000
      genesis_opts: {
        'app_state.staking.params.validator_bond_factor': '10',
        'app_state.slashing.params.downtime_jail_duration': '10s',
        'app_state.slashing.params.signed_blocks_window': '10',
      },
      config_opts: {
        'rpc.laddr': 'tcp://0.0.0.0:26657',
      },
      app_opts: {
        // 'rpc.laddr': 'tcp://0.0.0.0:26657',
      },
    },
    neutron: {
      image: 'neutron-node',
      binary: 'neutrond',
      chain_id: 'testneutron',
      denom: 'untrn',
      prefix: 'neutron',
      type: 'ics',
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
      upload: ['./contracts', './some.sh'],
      post_init: ['bash /opt/some.sh'],
    },
  },
  relayers: [
    {
      type: 'hermes',
      networks: ['lsm', 'neutron'],
      config: {},
      mnemonic:
        'laptop shy priority detect under sorry visit badge crew remind aware plate adapt eager taste',
      balance: '1000000000',
    },
  ],
  master_mnemonic:
    'metal stay delay motion actor cave elite lend because cook sunset echo',
  wallets: {
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

// const x = toml.parse(fs.readFileSync('./_config.toml', 'utf-8'));
// const x = toml.stringify(config);
// console.log(toml.parse(x));
// console.log(
//   JSON.stringify(
//     parse(fs.readFileSync('./docker-compose.yml', 'utf-8')),
//     null,
//     2,
//   ),
// );
