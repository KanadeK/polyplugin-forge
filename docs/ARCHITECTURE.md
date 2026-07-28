# Architecture

PolyPlugin Forge separates deterministic domain decisions from external effects.
The boundary exists to make security-sensitive behavior reviewable and to keep
core tests independent of the filesystem, network, process runner, and browser.

## System flow

```text
                         ┌───────────────────────────┐
                         │ canonical plugin.yaml     │
                         └─────────────┬─────────────┘
                                       │
                         safe YAML parse + strict schema
                                       │
                            semantic policy validation
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
  native manifest              publish preflight           compatibility
  generation + lint            and secret scan              evaluation
          │                            │                            │
 server.json                 build / test / entry       HTML / JSON / MD
 package.json                process adapters           evidence report
 manifest.json
 openapi.json

 versioned template + recorded baseline + current user files
                              │
                    deterministic three-way plan
                              │
             atomic apply or explicit conflict material
```

## Layers

| Layer           | Location        | Responsibility                                                  |
| --------------- | --------------- | --------------------------------------------------------------- |
| Domain core     | `src/core`      | Parse, validate, generate, compare, scan, and plan pure values. |
| Adapters        | `src/adapters`  | Filesystem and template-source effects.                         |
| Commands        | `src/commands`  | Convert CLI intent into core calls and controlled processes.    |
| Reporters       | `src/reporters` | Serialize stable human, JSON, Markdown, and HTML results.       |
| CLI boundary    | `src/cli.ts`    | Commander program, output channels, and exit behavior.          |
| Public API      | `src/index.ts`  | Supported pure functions and TypeScript types.                  |
| Product assets  | `templates`     | Versioned, offline-testable target projects.                    |
| Evidence        | `examples`      | Checked-in generated projects and native manifests.             |
| Release tooling | `scripts`       | Verification, demo, benchmark, packaging, and release checks.   |

The core receives plain values and narrow ports. It does not read the clock,
filesystem, network, environment variables, or process state directly. Manifest
adapters are pure generators and validators.

## Canonical model

`plugin.yaml` expresses:

- stable identity, version, package, license, and description;
- source and built entry points;
- target type and target-specific protocol information;
- capabilities, handlers, permissions, tests, and optional input schemas;
- explicit inbound and outbound data flows;
- privacy notice, personal-data collection, and telemetry declarations;
- operating-system, architecture, runtime, target-version, feature, and
  transport compatibility;
- a build or test command as an argument array.

Parsing is deliberately closed-world. Unknown fields fail the strict schema. The
parser accepts YAML core types, rejects custom tags and duplicate keys, and
enforces limits of 512 KiB, 32 aliases, 64 levels, and 10,000 nodes.

Semantic validation happens after structural parsing. It resolves cross-field
references, detects unused or missing permissions, requires capability tests and
privacy evidence, and validates target-specific constraints.

## Native manifest ownership

Each target generator owns one native output:

| Canonical target | Native output   | Important preserved intent                         |
| ---------------- | --------------- | -------------------------------------------------- |
| `mcp`            | `server.json`   | package, stdio transport, protocol metadata        |
| `vscode`         | `package.json`  | extension identity, engines, command contributions |
| `chrome`         | `manifest.json` | MV3 identity, popup, background, permissions       |
| `webhook`        | `openapi.json`  | OpenAPI 3.1 operation and request schema           |

Generation is deterministic and has no timestamp. `manifest generate --check`
compares the expected stable JSON with disk. `manifest lint` validates the
native document and checks that it still represents canonical intent.

## Preflight

Preflight uses the following order:

1. Parse and semantically validate `plugin.yaml`.
2. Validate referenced project paths and files.
3. Scan eligible text files for credential-shaped values.
4. Validate the target-native manifest.
5. Run the declared build and test commands.
6. Confirm that the declared built entry exists and stays inside the project.

Early static or security failures stop before project processes run. Commands
are spawned from explicit argument arrays with `shell: false`. On Windows, npm
is invoked through the current Node executable and npm CLI path rather than
through a command shell.

## Compatibility evidence

A compatibility cell combines one plugin declaration and one explicit
environment fixture. The evaluator reports one of four states:

- `tested`: compatible constraints plus recorded execution evidence;
- `unverified`: compatible declarations without execution evidence;
- `incompatible`: a declared constraint does not match the environment;
- `invalid`: the plugin or environment cannot be evaluated safely.

This distinction prevents a configuration match from being presented as a
runtime test. Reporters consume the same ordered cell model, so HTML, Markdown,
and JSON agree.

## Upgrade model

Every scaffold records template kind, version, answers, and baseline hashes
under `.polyplugin/`. An upgrade compares three materials:

1. **base** — the old bundled template rendered with the original answers;
2. **current** — the user’s project now;
3. **incoming** — the requested bundled template rendered with the same answers.

The planner classifies additions, safe replacements, preserved user-only files,
and ambiguous conflicts. A validated conflict-free plan is applied atomically.
When ambiguity exists, the project is not partially upgraded; review copies and
a machine-readable plan are written under `.polyplugin/conflicts/`. The JSON
plan contains paths and hashes, not raw user file contents.

## Safety invariants

1. Creation never writes into a non-empty target directory.
2. Template and managed paths reject absolute paths, traversal, NUL bytes, and
   symlink escapes.
3. Diagnostics never echo detected secret values.
4. Native manifest output is deterministic and contains no generation timestamp.
5. An upgrade applies an entirely validated plan or leaves ambiguous user files
   unchanged and emits conflict material.
6. Compatibility status distinguishes tested evidence from unverified
   declarations.
7. Core behavior never depends on a network service.

Tests map directly to these invariants. Unit tests exercise pure decisions;
integration tests exercise filesystem and CLI boundaries; Playwright tests
exercise built CLI workflows and the real Chrome template UI.

## Extension points

A new target requires:

1. a new canonical target definition and semantic rules;
2. a deterministic native generator and validator;
3. versioned templates with meaningful tests and a built entry;
4. compatibility fixtures;
5. CLI, unit, integration, E2E, release-package, privacy, and documentation
   coverage.

Avoid introducing a target through conditional filesystem logic in the core.
Keep effects in adapters and make target-specific differences explicit in the
canonical model.
