# Architecture

PolyPlugin Forge separates deterministic domain decisions from external effects.

## Layers

- `src/core` parses the canonical model, validates references and policy, plans
  upgrades, and computes compatibility results.
- `src/adapters` owns filesystem, process, Git, and platform-manifest I/O.
- `src/commands` maps CLI requests to core operations.
- `src/reporters` serializes stable text, JSON, and self-contained HTML.
- `templates` contains versioned, offline-capable plugin projects.

The core receives plain values and narrow ports. It does not read the clock,
filesystem, network, or process state directly. Manifest adapters are pure
generators and validators.

## Safety invariants

1. Creation never writes into a non-empty target directory.
2. Diagnostics never echo detected secret values.
3. Manifest output is deterministic and contains no generation timestamp.
4. An upgrade either applies an entirely validated plan or leaves user files
   unchanged and emits conflict material.
5. Compatibility status distinguishes tested evidence from unverified
   declarations.
