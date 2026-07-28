# Release checklist

The v0.1.0 tag is allowed only after every local and remote gate is evidenced.
The first group was completed against the release-preparation commit. The second
group must be completed on GitHub before the annotated tag is created.

## Local release preparation

- [x] Node.js clean `npm ci` install passes.
- [x] pnpm 11.9.0 frozen-lockfile install and supply-chain policy check pass.
- [x] Formatting, lint, typecheck, coverage, E2E, and build pass.
- [x] All four targets in template versions 1.0.0 and 1.1.0 install, test, and
      build.
- [x] Package and ZIP artifacts pass clean-directory verification.
- [x] Compatibility HTML is generated from the checked-in examples.
- [x] Source, generated-template secret, and empty-implementation scans pass.
- [x] Official npm advisory audit reports zero vulnerabilities.
- [x] Version, changelog, and artifact names agree on v0.1.0.
- [x] Author and committer match the authenticated GitHub identity.
- [x] No `Co-authored-by` trailer or unexpected commit identity exists.

Local evidence commands:

```bash
pnpm install --frozen-lockfile --ignore-scripts
npm ci
npm run security:audit
npm run security:scan
npm run verify
npm run demo
npm run benchmark
npm run package
npm run release-check
```

`make` is not installed on the release workstation, so the required
cross-platform npm/script equivalents are the executed evidence.

## Remote release closure

- [ ] Public `main` push is present at the expected release-preparation SHA.
- [ ] Linux quality, Windows/macOS template, security, and Pages workflows are
      green.
- [ ] The Pages demo is reachable and contains only checked-in synthetic data.
- [ ] An annotated `v0.1.0` tag points at the verified `main` commit.
- [ ] The GitHub Release is non-draft and non-prerelease.
- [ ] Every downloaded Release payload matches `SHA256SUMS.txt`.
- [ ] GitHub contributors contain no unexpected identity.

Do not mark this source checklist after the tag merely to record remote state;
the immutable GitHub Actions runs, annotated tag, Release metadata, checksums,
and final delivery report are the remote evidence.
