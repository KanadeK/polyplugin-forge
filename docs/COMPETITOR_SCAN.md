# Public repository sample scan

Scan date: 2026-07-23

Route: GitHub search through the authenticated `gh` CLI

Authenticated owner: `KanadeK`

Exact searches for `PolyPlugin Forge` and `polyplugin-forge` returned no
repositories. Searches for multi-platform plugin scaffolding, unified plugin
manifests, compatibility matrices, and safe template upgrades found adjacent
projects, but no active project in this sample combined more than roughly 38% of
the five MVP capability groups.

The overlap estimate considers: four target templates, a canonical manifest,
native manifest generation plus schema lint, publish-time security checks, and a
compatibility matrix with safe upgrades.

| Repository                                                                                              |  Stars | Updated (UTC) | Primary function                               | Approximate overlap |
| ------------------------------------------------------------------------------------------------------- | -----: | ------------- | ---------------------------------------------- | ------------------: |
| [PlasmoHQ/plasmo](https://github.com/PlasmoHQ/plasmo)                                                   | 13,114 | 2026-07-23    | Browser-extension SDK and publishing           |                 30% |
| [wxt-dev/wxt](https://github.com/wxt-dev/wxt)                                                           | 10,228 | 2026-07-23    | Cross-browser WebExtension framework           |                 28% |
| [extension-js/extension.js](https://github.com/extension-js/extension.js)                               |  5,044 | 2026-07-23    | Browser-extension creation and packaging       |                 32% |
| [crxjs/chrome-extension-tools](https://github.com/crxjs/chrome-extension-tools)                         |  4,131 | 2026-07-20    | Vite tooling for MV3 extensions                |                 20% |
| [mozilla/web-ext](https://github.com/mozilla/web-ext)                                                   |  3,119 | 2026-07-22    | Browser-extension lint, run, sign, and build   |                 22% |
| [microsoft/vscode-generator-code](https://github.com/microsoft/vscode-generator-code)                   |  1,617 | 2026-07-22    | Official VS Code extension generator           |                 15% |
| [sraveshnandan/mcpkit](https://github.com/sraveshnandan/mcpkit)                                         |      1 | 2026-07-08    | MCP templates, validation, and publishing      |                 38% |
| [rizwan-rizu/mcpinnit](https://github.com/rizwan-rizu/mcpinnit)                                         |      1 | 2026-04-10    | MCP scaffolding, manifests, and local tests    |                 35% |
| [ivan-magda/claude-code-plugin-template](https://github.com/ivan-magda/claude-code-plugin-template)     |     61 | 2026-07-22    | Claude Code plugin marketplace template        |                 28% |
| [extism/cli](https://github.com/extism/cli)                                                             |     25 | 2026-07-15    | Multi-language Extism/Wasm plugin creation     |                 22% |
| [hashicorp/packer-plugin-scaffolding](https://github.com/hashicorp/packer-plugin-scaffolding)           |     49 | 2026-04-05    | Packer plugin scaffolding and release workflow |                 18% |
| [copier-org/copier](https://github.com/copier-org/copier)                                               |  3,485 | 2026-07-23    | General templates with lifecycle updates       |                 22% |
| [cruft/cruft](https://github.com/cruft/cruft)                                                           |  1,576 | 2026-07-23    | Cookiecutter update, diff, and drift checks    |                 25% |
| [usnistgov/WIPP-Plugin-Manifest-generator](https://github.com/usnistgov/WIPP-Plugin-Manifest-generator) |      0 | 2022-09-30    | WIPP-specific manifest generator               |                 12% |
| [SchemaStore/schemastore](https://github.com/SchemaStore/schemastore)                                   |  3,807 | 2026-07-23    | Community JSON Schema catalog                  |                  8% |

## Decision

The project keeps the name `PolyPlugin Forge` and slug `polyplugin-forge`.
Instead of competing with full single-ecosystem runtimes, it focuses on one
canonical description that produces real MCP, VS Code, Chrome, and webhook
projects, backed by explicit security gates and evidence-bearing compatibility
reports.

The upgrade model adopts the safe intent seen in Copier and Cruft, while using
its own deterministic baseline snapshots and conflict plans so user files are
never overwritten silently.

This public-repository sample did not find an active project with the same name
and a highly isomorphic feature set. This is an evidence-bounded scan, not a
claim of global uniqueness.
