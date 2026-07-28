# Privacy and security

PolyPlugin Forge operates on local project files. The CLI does not provide
telemetry, analytics, cloud synchronization, credential storage, or an account
system.

This document describes v0.1.0 boundaries. It is not a guarantee that a
third-party project or a generated plugin is safe to execute.

## Data handling

| Data                       | Why it is read                                 | Leaves the machine?                                        |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| `plugin.yaml`              | Parse canonical intent and policy.             | No.                                                        |
| Referenced project files   | Validate paths, tests, schemas, and privacy.   | No.                                                        |
| Eligible text source files | Detect credential-shaped release material.     | No.                                                        |
| Native manifest            | Generate, compare, and validate target intent. | No.                                                        |
| Project build/test output  | Decide whether preflight passes.               | No by the CLI; the project command may behave differently. |
| Template state and hashes  | Plan safe upgrades.                            | No.                                                        |

No project contents are sent to a PolyPlugin Forge service because no such
service exists.

## Trust boundaries

The following inputs are untrusted:

- a plugin repository and its `plugin.yaml`;
- files and schemas referenced by the manifest;
- native manifests already on disk;
- environment catalogs used for compatibility reports;
- generated-project build and test commands;
- local edits involved in a template upgrade.

Bundled templates are part of the trusted release input. The release gate
installs, tests, and builds every target/version combination before packaging
them.

## Threat model and controls

### Parser resource abuse

The YAML parser:

- rejects documents over 512 KiB;
- accepts the core schema in strict mode;
- rejects duplicate keys and custom tags;
- allows at most 32 aliases;
- allows at most 64 levels and 10,000 nodes.

Schema objects are strict, so unknown fields fail rather than being ignored.

### Path traversal and symlink escape

Managed paths must be project-relative and normalized. Template paths reject
absolute paths, Windows drive paths, backslashes, traversal segments, NUL bytes,
and duplicate output paths. Template source directories cannot contain symlinks.
Referenced project files are resolved through real paths and must remain inside
the project root.

Creation refuses a non-empty destination. Upgrade writes only after validating
the complete plan; conflicts preserve the current user file and emit review
materials.

### Command injection

Build and test commands are modeled as argument arrays. Child processes run with
`shell: false` and hidden windows. The CLI does not concatenate manifest text
into a shell command.

This protects the invocation boundary, not the content of an executable project.
Running preflight on an untrusted repository executes its declared local build
and test programs with the current user’s permissions. Review those programs
first or use an isolated environment.

### Credential exposure

The scanner recognizes private-key headers, GitHub tokens, AWS access keys,
OpenAI keys, Slack tokens, JWTs, URL-embedded credentials, and common assigned
credential fields. Obvious examples and environment-variable references are
ignored to reduce false positives.

Findings report:

- detector code and credential category;
- source path;
- line and column;
- remediation guidance.

They do not include the matched value. JSON output uses the same redacted
diagnostic model. Upgrade JSON includes operation metadata and hashes, not raw
base/current/incoming file contents.

The scanner is a release guard, not a complete secret-management solution.
Rotate any credential that has entered Git history and use a dedicated
repository scanner when required by your organization.

### HTML report injection

Compatibility HTML escapes plugin, environment, reason, and evidence text. The
report is self-contained and does not load third-party scripts, fonts, or
analytics.

### Network behavior

Core parsing, linting, scaffolding, manifest generation, matrix generation,
upgrade planning, and their tests are offline-capable. PolyPlugin Forge itself
does not make network requests.

`npm ci`, package installation, and a generated project’s own scripts can access
the network according to npm and project configuration. The bundled webhook
sample binds only to a loopback address. Generated MCP, VS Code, and Chrome
plugins follow their own declared permissions and host environment.

## Preflight order and failure behavior

Static validation, native manifest validation, and secret scanning occur before
project build or test commands. A failure exits non-zero. Sensitive values are
not included in human or JSON output. Directories such as `.git`, `.polyplugin`,
`node_modules`, build output, coverage, and release output are excluded from
routine source scanning.

Release automation additionally performs source hygiene, clean installation,
artifact installation, template build, built-entry, naming, version, changelog,
checksum, Git identity, and clean-worktree checks.

## Release artifact integrity

`npm run package` creates deterministic template ZIPs, a packed npm tarball, a
compatibility HTML report, and `SHA256SUMS.txt`. The tarball is installed in a
fresh directory without registry dependency and its CLI version is checked. Each
template artifact is generated from a bundled template, installed from its
lockfile, tested, built, and checked for its declared entry before archiving.

Consumers should download the checksum file from the same GitHub Release and
verify it with a trusted SHA-256 tool.

## Responsible disclosure

Do not open a public issue for a suspected vulnerability or exposed credential.
Follow [SECURITY.md](../SECURITY.md) for supported versions and private
reporting instructions.
