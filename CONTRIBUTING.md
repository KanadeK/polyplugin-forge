# Contributing

Thank you for improving PolyPlugin Forge.

1. Open an issue for behavior changes that affect the canonical manifest.
2. Create a focused branch from `main`.
3. Add tests that cover success, failure, and privacy behavior.
4. Run `npm run verify`.
5. Submit a pull request using the repository template.

Generated output must be deterministic. Tests must not depend on an external
service, wall-clock delays, or mutable online data. Do not commit credentials,
personal data, generated dependency folders, or third-party assets without a
compatible license.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
