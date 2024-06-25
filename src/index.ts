#!/usr/bin/env node
import { program } from 'commander';
import toml from '@iarna/toml';
import { CosmoparkConfig } from './types';
import { Cosmopark } from './cosmopark';
import fs from 'fs';

const parseConfig = (configFile: string): CosmoparkConfig => {
  let config: CosmoparkConfig;
  if (configFile.endsWith('.toml')) {
    config = toml.parse(
      fs.readFileSync(configFile, 'utf-8'),
    ) as CosmoparkConfig;
  } else if (configFile.endsWith('.json')) {
    config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  } else {
    console.log('Unknown file format');
  }
  return config;
};

if (require.main === module) {
  program
    .name('cosmopark')
    .description('CLI to start your own cosmos')
    .command('start')
    .argument('<config>', 'config file path, may me toml or json')
    .action(async (configFile) => {
      const config = parseConfig(configFile);
      console.log('🚀 Starting');
      try {
        await Cosmopark.create(config);
      } catch (e) {
        console.log('ERROR', e);
        console.log('ERROR', e.message);
      }
      console.log('🥳 Done');
      process.exit(0);
    });

  program
    .command('stop')
    .argument('<config>', 'config file path, may me toml or json')
    .action(async (configFile) => {
      const config = parseConfig(configFile);
      console.log('✋ stopping');
      const instance = new Cosmopark(config);
      await instance.stop();
    });

  program.parse();
}

export default Cosmopark;
export { CosmoparkConfig };
