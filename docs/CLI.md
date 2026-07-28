# CLI reference

The executable is `polyplugin`. Node.js `>=22 <25` is required. All relative
paths resolve from the current working directory.

## Output and exit behavior

- Successful commands exit `0`.
- Invalid input, failed policy, stale manifests, build/test failures, conflicts,
  and unsafe writes exit non-zero.
- Human output is the default.
- Commands that accept `--json` emit a stable JSON object to standard output.
- Diagnostics are ordered and redact detected credential values.
- Commander usage errors are written to standard error.

## `create`

```text
polyplugin create <dir>
  --template <mcp|vscode|chrome|webhook>
  --plugin-id <id>
  --name <name>
  --description <text>
  --package-name <name>
  [--template-version <version>]
```

Creates a rendered project in an empty destination. The default template version
is `1.0.0`; v0.1.0 bundles `1.0.0` and `1.1.0`.

The plugin ID must be a lowercase dot, dash, or underscore identifier. The
package name follows safe npm naming syntax. Display names are limited to 80
characters and descriptions to 280 characters.

## `lint`

```text
polyplugin lint [dir] [--format human|json] [--json]
```

Parses `plugin.yaml`, applies the strict schema and semantic rules, then
validates referenced source, entry, schema, privacy, and test paths.

## `manifest generate`

```text
polyplugin manifest generate [dir]
  [--check]
  [--format human|json]
  [--json]
```

Generates the target-native manifest. `--check` does not write; it fails if the
existing native output differs from deterministic expected output.

## `manifest lint`

```text
polyplugin manifest lint [dir]
  [--format human|json]
  [--json]
```

Validates the native manifest and checks that important target fields still
match `plugin.yaml`.

## `preflight`

```text
polyplugin preflight [dir] [--format human|json] [--json]
```

Runs the local publish gate:

1. canonical and semantic validation;
2. referenced-file validation;
3. redacted secret scan;
4. native-manifest validation;
5. declared build and test processes;
6. built-entry existence and containment.

Static and security failures stop before project processes execute.

## `matrix`

```text
polyplugin matrix <dirs...>
  --catalog <environment-yaml>
  --out <output-file>
  [--format html|json|md]
```

Evaluates one or more plugin directories against explicit environments. The
output extension selects the reporter when `--format` is omitted.

The result distinguishes tested, unverified, incompatible, and invalid cells. It
does not turn a declaration into runtime evidence.

## `upgrade`

```text
polyplugin upgrade [dir]
  --to <version>
  [--dry-run]
  [--continue]
  [--format human|json]
  [--json]
```

`--dry-run` reports the three-way plan without writing. A normal run applies a
fully validated, conflict-free plan. Ambiguous changes create review material
under `.polyplugin/conflicts/` without silently replacing the current user file.

After resolving every current file identified by the conflict plan, use
`--continue`. If new conflicts appeared since the plan was created, continuation
fails and requires a new review.

## Examples

```bash
polyplugin lint examples/mcp-hello --json

polyplugin manifest generate examples/chrome-hello --check

polyplugin matrix \
  examples/mcp-hello \
  examples/vscode-hello \
  --catalog fixtures/compatibility-environments.yaml \
  --out matrix.json

polyplugin upgrade ./my-plugin --to 1.1.0 --dry-run --json
```
