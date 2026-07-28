# Deterministic pipeline benchmark

This benchmark measures the in-process domain pipeline used by the demo:

1. parse four checked-in `plugin.yaml` files;
2. generate and validate four target-native manifests;
3. evaluate those plugins against four checked-in environments;
4. render the 16-cell compatibility matrix as self-contained HTML.

It does not measure dependency installation, template builds, browser startup,
network access, or extension-host startup.

## Command

```bash
npm run benchmark
```

The script performs 10 warm-up iterations followed by 50 measured iterations and
writes the complete machine-readable result to `demo-output/benchmark.json`.

## v0.1.0 local result

Measured on 2026-07-28:

| Property        | Value                   |
| --------------- | ----------------------- |
| Node.js         | v24.18.0                |
| Platform        | Windows 10.0.26200, x64 |
| CPU             | Intel Core i9-14900HX   |
| Logical cores   | 32                      |
| Reported memory | 32,560 MiB              |
| Plugins         | 4                       |
| Environments    | 4                       |
| Matrix cells    | 16                      |
| HTML output     | 25,805 bytes            |
| Warm-up runs    | 10                      |
| Measured runs   | 50                      |
| Minimum         | 3.316 ms                |
| p50             | 4.229 ms                |
| p95             | 6.043 ms                |
| Maximum         | 6.511 ms                |

These are local observations, not a cross-machine performance guarantee. Release
CI pins Node.js 22, while this measurement used a supported Node.js 24 runtime.
The fixed checked-in dataset and machine-readable script make a fresh comparison
reproducible.
