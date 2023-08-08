#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cosmopark = void 0;
const commander_1 = require("commander");
const toml_1 = __importDefault(require("@iarna/toml"));
const cosmopark_1 = require("./cosmopark");
Object.defineProperty(exports, "Cosmopark", { enumerable: true, get: function () { return cosmopark_1.Cosmopark; } });
const fs_1 = __importDefault(require("fs"));
if (require.main === module) {
    commander_1.program
        .name('cosmopark')
        .description('CLI to start your own cosmos')
        .command('start')
        .argument('<config>', 'config file path, may me toml or json')
        .action(async (str) => {
        let config;
        if (str.endsWith('.toml')) {
            config = toml_1.default.parse(fs_1.default.readFileSync(str, 'utf-8'));
        }
        else if (str.endsWith('.json')) {
            config = JSON.parse(fs_1.default.readFileSync(str, 'utf-8'));
        }
        else {
            console.log('Unknown file format');
        }
        console.log('🚀 Starting');
        try {
            await cosmopark_1.Cosmopark.create(config);
        }
        catch (e) {
            console.log('ERROR', e);
            console.log('ERROR', e.message);
        }
        console.log('🥳 Done');
    });
    commander_1.program.parse();
}
