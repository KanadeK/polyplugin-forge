# Release checklist

The v0.1.0 release is allowed only after every item is evidenced.

- [ ] Node.js 22 clean install passes.
- [ ] pnpm frozen-lockfile install passes.
- [ ] Formatting, lint, typecheck, coverage, E2E, and build pass.
- [ ] All four generated templates install, test, and build.
- [ ] Package and ZIP artifacts pass clean-directory verification.
- [ ] Compatibility HTML is generated from the checked-in examples.
- [ ] Secret and forbidden-marker scans pass.
- [ ] Version, changelog, tag, and artifact names agree.
- [ ] Git worktree is clean.
- [ ] Author and committer match the authenticated GitHub identity.
- [ ] GitHub Actions is green before the annotated tag is pushed.
- [ ] Release assets are downloadable and match `SHA256SUMS.txt`.
- [ ] GitHub contributors contain no unexpected identity.
