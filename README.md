# PolyPlugin Forge

[简体中文](README.zh-CN.md)

[![CI](https://github.com/KanadeK/polyplugin-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/KanadeK/polyplugin-forge/actions/workflows/ci.yml)
[![Security](https://github.com/KanadeK/polyplugin-forge/actions/workflows/security.yml/badge.svg)](https://github.com/KanadeK/polyplugin-forge/actions/workflows/security.yml)
[![Release](https://img.shields.io/github/v/release/KanadeK/polyplugin-forge)](https://github.com/KanadeK/polyplugin-forge/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

One plugin description, four real targets, and evidence you can inspect before
shipping.

Plugin teams repeatedly express the same capabilities, permissions, data flows,
runtime constraints, and tests in incompatible formats. PolyPlugin Forge keeps
that intent in one auditable `plugin.yaml`, then generates and checks native
MCP, VS Code, Chrome Manifest V3, and OpenAPI webhook projects.

![A generated PolyPlugin Forge compatibility matrix showing four checked-in plugin examples against four environments](docs/assets/demo.png)

**Current release: v0.1.0**

- Scaffold complete, offline-testable projects for four plugin targets.
- Generate native manifests, run publish-time security checks, and produce an
  evidence-aware compatibility matrix.
- Upgrade bundled templates with a three-way plan that never silently overwrites
  user changes.

Install the signed-off release package directly from GitHub:

```bash
npm install --global https://github.com/KanadeK/polyplugin-forge/releases/download/v0.1.0/polyplugin-forge-0.1.0-npm.tgz
polyplugin --version
```

The CLI is local-first: no telemetry, analytics, credential storage, or cloud
sync. Core validation and generation require no network. Generated code still
runs with the permissions declared by its own `plugin.yaml`; review those
permissions and the native manifest before publishing.

## Real input → real output

Given this canonical input:

```yaml
metadata:
  id: hello.mcp
  version: 0.1.0
  package: hello-mcp
target:
  type: mcp
  protocolVersion: "2025-06-18"
  transport: stdio
privacy:
  notice: docs/PRIVACY.md
  collectsPersonalData: false
  telemetry: false
```

Run:

```bash
polyplugin manifest generate examples/mcp-hello
polyplugin manifest lint examples/mcp-hello
```

The checked-in example produces a native `server.json`:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json",
  "description": "Returns a deterministic greeting over MCP stdio.",
  "name": "hello.mcp",
  "packages": [
    {
      "identifier": "hello-mcp",
      "registryType": "npm",
      "transport": { "type": "stdio" },
      "version": "0.1.0"
    }
  ],
  "version": "0.1.0"
}
```

## Features

- A size-limited, safe-YAML parser and typed schema for identity, runtime,
  capabilities, permissions, data flows, privacy, compatibility, and tests.
- Semantic lint for undeclared or unused permissions, missing privacy notices,
  missing test references, invalid entries, and unsafe project paths.
- Deterministic native manifest generation and validation:
  - MCP `server.json`
  - VS Code `package.json` contributions
  - Chrome Manifest V3 `manifest.json`
  - OpenAPI 3.1 `openapi.json`
- Publish preflight covering static validity, secret-like values, native
  manifests, build, tests, and the built entry point.
- HTML, Markdown, and JSON compatibility matrices that distinguish **tested**,
  **unverified**, **incompatible**, and **invalid** evidence.
- Non-destructive three-way template upgrades with explicit conflict material
  under `.polyplugin/conflicts/`.
- Human-readable and JSON CLI output, plus a typed library API.
- Versioned `1.0.0` and `1.1.0` templates for every supported target.

## Non-goals

PolyPlugin Forge does not:

- replace MCP, VS Code, Chrome, or HTTP runtimes;
- publish to npm, extension stores, or a production webhook host;
- fetch or execute arbitrary remote templates;
- claim that a declared compatibility row was tested when no evidence exists;
- hide permission or data-flow differences behind a lowest-common-denominator
  runtime.

## Architecture

```text
plugin.yaml
    │
    ├─ safe parse + schema + semantic policy
    │
    ├─ native manifest generator ──> server.json / package.json /
    │                                manifest.json / openapi.json
    ├─ preflight adapters ─────────> secrets / build / tests / entry
    ├─ compatibility evaluator ────> HTML / Markdown / JSON evidence
    └─ template state + baselines ─> three-way upgrade plan
```

Deterministic decisions live in `src/core`. Filesystem, process, Git, and
browser effects live behind adapters. Commands translate user intent; reporters
only serialize results. See [Architecture](docs/ARCHITECTURE.md) for invariants
and repository layout.

## Installation

### GitHub Release

Requires Node.js `>=22 <25`.

```bash
npm install --global https://github.com/KanadeK/polyplugin-forge/releases/download/v0.1.0/polyplugin-forge-0.1.0-npm.tgz
```

Release assets include the npm tarball, four ready-to-inspect template ZIPs, a
compatibility report, and `SHA256SUMS.txt`.

### From source

```bash
git clone https://github.com/KanadeK/polyplugin-forge.git
cd polyplugin-forge
npm ci
npm run build
node dist/cli.js --help
```

`pnpm install --frozen-lockfile` is also supported by the checked-in workspace
lockfile.

## Quick start

Create a real MCP project:

```bash
polyplugin create hello-mcp \
  --template mcp \
  --plugin-id com.example.hello-mcp \
  --name "Hello MCP" \
  --description "Return a deterministic greeting." \
  --package-name hello-mcp

cd hello-mcp
npm ci
npm test
npm run build
polyplugin preflight .
```

The same command accepts `vscode`, `chrome`, or `webhook` as the template.
Creation refuses to write into a non-empty destination.

## Complete workflows

### Audit an existing project

```bash
polyplugin lint ./my-plugin
polyplugin manifest generate ./my-plugin --check
polyplugin manifest lint ./my-plugin
polyplugin preflight ./my-plugin
```

Add `--json` to lint, manifest, preflight, or upgrade commands for stable
machine-readable diagnostics. Secret findings include detector and location,
never the matched value.

### Generate a compatibility report

```bash
polyplugin matrix \
  examples/mcp-hello \
  examples/vscode-hello \
  examples/chrome-hello \
  examples/webhook-hello \
  --catalog fixtures/compatibility-environments.yaml \
  --out compatibility.html
```

Use `--format json`, `--format md`, or select the format through the output
extension.

### Upgrade without losing local changes

```bash
polyplugin upgrade ./my-plugin --to 1.1.0 --dry-run
polyplugin upgrade ./my-plugin --to 1.1.0
```

Unambiguous additions and unchanged-template replacements are applied together.
If a bundled template and a user changed the same managed file, no ambiguous
write occurs. Resolve the copies in `.polyplugin/conflicts/`, update the current
file, then continue:

```bash
polyplugin upgrade ./my-plugin --to 1.1.0 --continue
```

## CLI and library API

| Command                    | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `create <dir>`             | Render one bundled target template into an empty directory.   |
| `lint [dir]`               | Parse and semantically validate `plugin.yaml` and references. |
| `manifest generate [dir]`  | Generate, or `--check`, a target-native manifest.             |
| `manifest lint [dir]`      | Validate the native manifest against canonical intent.        |
| `preflight [dir]`          | Run the local publish-time safety and completeness gate.      |
| `matrix <dirs...>`         | Render compatibility evidence as HTML, JSON, or Markdown.     |
| `upgrade [dir] --to <ver>` | Plan or apply a non-destructive three-way template upgrade.   |

See [CLI reference](docs/CLI.md) for every option and exit behavior.

The package also exports pure domain functions:

```ts
import {
  evaluateCompatibilityMatrix,
  generateAndValidateManifest,
  parsePluginManifest,
  validatePluginDefinition
} from "polyplugin-forge";

const parsed = parsePluginManifest(yamlSource);
if (parsed.value) {
  const diagnostics = validatePluginDefinition(parsed.value);
  const manifest = generateAndValidateManifest(parsed.value);
}
```

## Examples and fixtures

| Path                                       | Native output   | Meaningful behavior                            |
| ------------------------------------------ | --------------- | ---------------------------------------------- |
| `examples/mcp-hello`                       | `server.json`   | MCP stdio `hello` tool.                        |
| `examples/vscode-hello`                    | `package.json`  | Registered VS Code greeting command.           |
| `examples/chrome-hello`                    | `manifest.json` | Accessible MV3 popup with deterministic state. |
| `examples/webhook-hello`                   | `openapi.json`  | Loopback-only HTTP greeting endpoint.          |
| `fixtures/compatibility-environments.yaml` | —               | Four explicit target environments for reports. |

Every template has a privacy notice, license, tests, a build script, a built
entry check, and a lockfile. The release gate installs, tests, and builds all
eight target/version combinations.

## Testing and reproducibility

```bash
npm ci
npm run verify
npm run demo
npm run benchmark
npm run package
npm run release-check
```

`npm run verify` runs formatting, lint, type checking, Vitest coverage, all
template builds, Playwright E2E, and the production build. The v0.1.0 local
baseline is 94 Vitest tests plus 7 Playwright tests, with 87.85% statement,
80.78% branch, 94.49% function, and 87.77% line coverage. The domain core has
95.10% line and 88.20% branch coverage.

The deterministic benchmark uses four checked-in plugins and four checked-in
environments. See the exact machine, method, and results in
[Benchmark](docs/BENCHMARK.md).

## Privacy and security

- No telemetry, analytics, cloud sync, or credential storage.
- YAML size, alias, tag, and nesting limits reduce parser abuse.
- Managed paths reject traversal, absolute paths, and symlink escapes.
- Child processes receive argument arrays and run without a command shell.
- Secret diagnostics and JSON upgrade plans do not echo file contents or matched
  credentials.
- The webhook example binds only to loopback.
- Release artifacts are installed in clean temporary directories and published
  with SHA-256 checksums.

Read the threat model and trust boundaries in
[Privacy and security](docs/PRIVACY_AND_SECURITY.md). Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

## Differentiation

A dated sample of 15 public repositories found strong tools for individual
ecosystems and general template updating, but no same-name or highly isomorphic
active project in that sample. PolyPlugin Forge combines four real target
templates, one auditable manifest, native-manifest checks, publish-time security
gates, evidence-aware compatibility, and non-destructive upgrades. This is a
bounded comparison, not a claim of global uniqueness. See the full
[competitor scan](docs/COMPETITOR_SCAN.md).

## Roadmap

- Publish a stable `v1` canonical schema after real-world manifest feedback.
- Add opt-in store-specific packaging adapters without weakening local-first
  behavior.
- Import existing native manifests into a reviewable canonical draft.
- Add signed provenance for release artifacts.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), run `npm ci` and `npm run verify`, and
include tests for observable behavior. Do not add telemetry or silently broaden
permissions. Architecture changes should preserve the safety invariants.

## FAQ

### Does one manifest make all four targets identical?

No. It centralizes shared intent and keeps target-specific constraints explicit.
Each native generator validates the target it owns.

### Does “compatible” mean the plugin ran in that environment?

Only a **tested** cell carries evidence. A declaration without execution is
**unverified**, not silently promoted to tested.

### Can an upgrade overwrite my changes?

Not silently. Three-way comparison distinguishes the old template baseline, your
current file, and the incoming template. Ambiguity becomes conflict material for
review.

### Does preflight upload my source?

No. Preflight reads local files and runs the project’s declared local build and
test commands. Review those commands before running an untrusted project.

### Is npm registry publication required?

No. v0.1.0 is distributed as a verified GitHub Release tarball and source
repository. Generated templates remain ordinary npm-compatible Node projects.

## License

[MIT](LICENSE) © KanadeK
