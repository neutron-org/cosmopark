#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const toml_1 = __importDefault(require("@iarna/toml"));
const cosmopark_1 = require("./cosmopark");
const fs_1 = __importDefault(require("fs"));
const parseConfig = (configFile) => {
    let config;
    if (configFile.endsWith('.toml')) {
        config = toml_1.default.parse(fs_1.default.readFileSync(configFile, 'utf-8'));
    }
    else if (configFile.endsWith('.json')) {
        config = JSON.parse(fs_1.default.readFileSync(configFile, 'utf-8'));
    }
    else {
        console.log('Unknown file format');
    }
    return config;
};
if (require.main === module) {
    commander_1.program
        .name('cosmopark')
        .description('CLI to start your own cosmos')
        .command('start')
        .argument('<config>', 'config file path, may me toml or json')
        .action(async (configFile) => {
        const config = parseConfig(configFile);
        console.log('🚀 Starting');
        try {
            await cosmopark_1.Cosmopark.create(config);
        }
        catch (e) {
            console.log('ERROR', e);
            console.log('ERROR', e.message);
        }
        console.log('🥳 Done');
        process.exit(0);
    });
    commander_1.program
        .command('stop')
        .argument('<config>', 'config file path, may me toml or json')
        .action(async (configFile) => {
        const config = parseConfig(configFile);
        console.log('✋ stopping');
        const instance = new cosmopark_1.Cosmopark(config);
        await instance.stop();
    });
    commander_1.program.parse();
}
exports.default = cosmopark_1.Cosmopark;
