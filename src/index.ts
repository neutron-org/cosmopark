#!/usr/bin/env node
import { program } from 'commander';
import toml from '@iarna/toml';
import { CosmoparkConfig } from './types';
import { Cosmopark } from './cosmopark';
import fs from 'fs';

if (require.main === module) {
  program
    .name('cosmopark')
    .description('CLI to start your own cosmos')
    .command('start')
    .argument('<config>', 'config file path, may me toml or json')
    .action(async (str) => {
      let config: CosmoparkConfig;
      if (str.endsWith('.toml')) {
        config = toml.parse(fs.readFileSync(str, 'utf-8')) as CosmoparkConfig;
      } else if (str.endsWith('.json')) {
        config = JSON.parse(fs.readFileSync(str, 'utf-8'));
      } else {
        console.log('Unknown file format');
      }
      console.log('🚀 Starting');
      try {
        await Cosmopark.create(config);
      } catch (e) {
        console.log('ERROR', e);
        console.log('ERROR', e.message);
      }
      console.log('🥳 Done');
    });

  program.parse();
}

export { Cosmopark };
