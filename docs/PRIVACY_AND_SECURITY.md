# Privacy and security

PolyPlugin Forge operates on local project files. The CLI does not provide
telemetry, analytics, cloud synchronization, or credential storage.

## Trust boundary

Plugin manifests, templates, and generated projects are untrusted input. The
implementation rejects path traversal, absolute managed paths, symlink escapes,
overly large YAML documents, unsafe YAML features, and secret-like values in
release artifacts. Child processes are invoked with argument arrays and without
a command shell.

## Diagnostic redaction

Secret checks report a detector type and source location. They never include the
matched value. JSON and human-readable reporters share the same redacted
diagnostic model.

## Network behavior

Core validation, scaffolding, manifest generation, matrix generation, and
template tests are deterministic and offline-capable. A generated webhook sample
binds only to a loopback interface. Online registries are not required for core
tests.

See [SECURITY.md](../SECURITY.md) for vulnerability reporting.
