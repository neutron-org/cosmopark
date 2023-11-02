"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseMutex = exports.getMutexCounter = void 0;
const node_net_1 = __importDefault(require("node:net"));
const logger_1 = require("./logger");
let counter = -1;
let server = null;
const getMutexCounter = async () => {
    if (counter !== -1) {
        return counter;
    }
    counter = 0;
    const startPort = 6666;
    const mutexLogger = logger_1.logger.child({ module: 'mutex' });
    // eslint-disable-next-line no-constant-condition
    while (counter < 1000) {
        mutexLogger.debug(`checking port ${startPort + counter}`);
        const res = await new Promise((r) => {
            server = node_net_1.default
                .createServer()
                .listen(startPort + counter)
                .on('listening', () => r(true))
                .on('error', (e) => {
                mutexLogger.debug(e);
                mutexLogger.debug(`port ${startPort + counter} is busy`);
                counter++;
                r(false);
            });
        });
        if (res) {
            return counter;
        }
    }
    mutexLogger.error('No free ports');
    throw new Error('No free ports');
};
exports.getMutexCounter = getMutexCounter;
const releaseMutex = async () => {
    if (server) {
        await new Promise((r) => server?.close(r));
    }
};
exports.releaseMutex = releaseMutex;
