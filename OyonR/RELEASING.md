# Releasing Oyon

Oyon releases are immutable packages, not moving branches. Every release tag
produces one npm tarball. CI installs that tarball in an empty consumer project,
checks its peer assets and production dependency tree, attaches the exact file
and `SHA256SUMS` to a GitHub Release, and publishes the same bytes to npm.

## Release policy

- Never move or replace a published tag. Correct release defects with a patch
  version, including defects in packaging or CI.
- Keep `package.json`, `package-lock.json`, the changelog and the `vX.Y.Z` tag in
  agreement.
- Downstream production builds must pin an exact tag or package version. They
  must not clone `main`, another branch, or an unbounded version range.
- The GitHub Release tarball is the canonical self-hosted fallback. Verify it
  against `SHA256SUMS` before installing it.
- A release is complete only after its workflow, GitHub Release assets and
  isolated-consumer verification all pass. npm publication is an additional
  distribution channel, not the only copy of the package.

## Maintainer procedure

1. Update the package and lockfile versions and add a changelog entry.
2. Run `npm ci`, `npm --prefix standalone/app ci`, and
   `npm run prepublishOnly` from a clean checkout.
3. Commit the release, create an annotated `vX.Y.Z` tag, and push the commit and
   tag.
4. Monitor the **Release Oyon** workflow. Confirm the GitHub Release contains
   `oyon-X.Y.Z.tgz` and `SHA256SUMS`, then confirm the npm package if registry
   publication is configured.
5. Update downstream pins only after the immutable GitHub artifact exists.

Registry publication requires the repository `NPM_TOKEN` secret (or a future
npm trusted-publishing configuration) to be authorized for the `oyon` package.
