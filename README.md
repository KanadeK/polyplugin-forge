# PolyPlugin Forge

PolyPlugin Forge is a local-first toolkit for describing a plugin once and
producing auditable scaffolds, native manifests, release checks, and
compatibility evidence for MCP, VS Code, Chrome, and webhook targets.

The repository is developed as a sequence of reviewed milestones. Its domain
core is intentionally independent from the filesystem, process runner, and
browser adapters so the important decisions can be tested without a network or
UI.

## Current scope

- Canonical `plugin.yaml` with explicit capabilities, permissions, data flows,
  privacy, runtime, and compatibility constraints.
- Four deterministic hello-world templates.
- Native manifest generation and schema validation.
- Publish-time security and completeness checks.
- Compatibility reports and non-destructive template upgrades.

The public v0.1.0 release is gated on complete local verification, GitHub
Actions, artifact installation tests, and contributor identity checks.

## Development

Node.js 22 is the supported release runtime. Dependencies are managed as a pnpm
workspace, while the release gate also supports a clean `npm ci` install.

```bash
npm ci
npm run verify
```

See [Architecture](docs/ARCHITECTURE.md),
[Privacy and security](docs/PRIVACY_AND_SECURITY.md), and the
[competitor scan](docs/COMPETITOR_SCAN.md) for the design boundaries.

## License

[MIT](LICENSE)
