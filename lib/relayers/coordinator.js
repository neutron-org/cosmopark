"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmoparkCoordinatorRelayer = void 0;
const docker_compose_1 = __importDefault(require("docker-compose"));
class CosmoparkCoordinatorRelayer {
    filename;
    name;
    relayerType;
    debug = false;
    constructor(name, type, filename) {
        this.name = name;
        this.relayerType = type;
        this.filename = filename;
    }
    get type() {
        return this.relayerType;
    }
    execInNode(command) {
        return docker_compose_1.default.exec(this.name, [`sh`, `-c`, command], {
            config: this.filename,
            log: this.debug,
        });
    }
}
exports.CosmoparkCoordinatorRelayer = CosmoparkCoordinatorRelayer;
