# Contributing

Start with the [Contributing section of the README](README.md#handshake-contributing) for setup,
then read [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md), and the standards in
[QUALITY_BASELINE.md](QUALITY_BASELINE.md). Before you open a pull request, run `npm run check`
and `npm run test:integration`.

Report security problems privately as described in [SECURITY.md](SECURITY.md), not in issues.
Sign your commits with `git commit -s` to certify the
[Developer Certificate of Origin](https://developercertificate.org/).

## Publishing

`.github/workflows/release.yml` builds and verifies a version tag, creates a GitHub release, and
publishes the tested VSIX using Marketplace trusted publishing (`vsce publish --oidc`). Manual
runs only build and test; they publish nothing.

Create this policy under the `bluecloud-dev` publisher's **Trusted Publishing** tab in the
[Marketplace publisher settings](https://marketplace.visualstudio.com/manage/publishers/bluecloud-dev/trustedpublishing):

| Field            | Value                   |
| ---------------- | ----------------------- |
| Policy name      | `Proxy Toggler release` |
| Provider         | GitHub Actions          |
| Repository owner | `bluecloud-dev`         |
| Repository       | `proxy-toggler`         |
| Workflow         | `release.yml`           |
| Environment      | `marketplace`           |

The GitHub `marketplace` environment must restrict deployments to tags matching `v*.*.*`. Only
the Marketplace job gets `id-token: write`. No PAT or Microsoft Entra application is required.
Create the policy before releasing with this workflow.

The public **Verified Publisher** badge is separate: it requires domain ownership verification
and Marketplace approval in the publisher's **Details** tab. See Microsoft's
[publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
