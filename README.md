# Bhuiyan Store distribution system

Multi-brand distribution management for one distributor: batch inventory, DSR daily summaries,
SR money accounts, damage replacement, supplier deposits and reports. Bangla UI, mobile
responsive, online only.

- Specification: [docs/DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md](docs/DISTRIBUTION_SOFTWARE_IMPLEMENTATION_GUIDE.md)
- Status: [docs/implementation-status.md](docs/implementation-status.md)
- Contributor/agent rules: [AGENTS.md](AGENTS.md)

## Requirements

- Node.js 24.11+ (see `.node-version`)
- pnpm 10.22.0 (`corepack enable` picks it up from `packageManager`)

## Getting started


```sh
pnpm install
pnpm dev     # http://localhost:3000
pnpm check   # format, lint, module boundaries, types, domain tests
pnpm build
```
