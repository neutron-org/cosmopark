# Cosmopark

This one is a tool to run your own Cosmos (Cosmos-SDK based blockchains).
It supports standard cosmos-sdk chains and ICS (as for now tested with Neutron). Basically all you have to do is:

- prepare docker images (or just use some from a hub)
- create config
- run `npx @neutron-org/cosmopark start your_config.toml`

## Relayers

It will NOT work with hermes versions above 1.4.0. as for now

## Configuration

Please find [TOML sample](./sample_config.toml) or [JSON sample](./sample_config.json)
