# Code-Scanning Remediation Design

## Baseline

The live `main` baseline on 2026-08-30 is 73 open alerts:

- 68 OpenSSF `PinnedDependenciesID` findings across five workflows.
- 3 OpenSSF `TokenPermissionsID` findings: two in the release workflow and one in CodeQL.
- 1 OpenSSF `CodeReviewID` repository-policy finding.
- 1 CodeQL `js/incomplete-multi-character-sanitization` finding in the website search-index builder.

## Dispositions

The sanitization alert is a real robustness issue even though the current search results are serialized as JSON and rendered by React as text. A multi-character regular-expression removal is the wrong primitive for untrusted markup-shaped input because deletions can expose a new sequence. Replace it with a single-pass scanner that never copies `<` or tag contents to its output. Direct helper tests will cover ordinary tags, nested/adversarial tags, malformed unterminated tags, and surrounding searchable prose.

The 68 dependency findings are workflow-hardening opportunities. Every reported `uses:` reference is currently a mutable tag. Pin each reference to the full commit SHA currently resolved by its existing tag and retain a version comment for maintainability. Dependabot's existing `github-actions` updater remains the update path.

The CodeQL permission finding is a workflow-hardening opportunity: keep read-only permissions at workflow scope and grant the analysis job exactly `actions: read`, `contents: read`, and `security-events: write`. The release workflow findings are also hardening opportunities. Add read-only workflow defaults, keep its `GITHUB_TOKEN` at `contents: read` plus the required `id-token: write`, remove `pull-requests: write`, and expose the existing `RELEASE_GITHUB_TOKEN` only to the Changesets and auto-merge steps that require repository writes. Do not add npm tokens; trusted publishing remains OIDC-only. Repository-secret metadata proves when and where the secret is configured but cannot expose the underlying PAT's repository selection, expiration, or grants; those must be verified through the credential's account-side configuration and reported as an external control rather than inferred.

The code-review finding is a true repository-governance gap. The repository currently has one collaborator, so it cannot satisfy a second-human approval rule without making all maintenance impossible. Required status checks, CodeQL, Scorecard, security audit, immutable workflow dependencies, protected `main`, and merge-on-green are compensating controls, but they are not equivalent to human review. Leave the alert open and report it as residual rather than dismissing it.

The sanitizer PR's first preview run also exposed a separate fail-open deployment bug: `vercel deploy | tail -n 1` returned a successful pipeline status when the Vercel CLI itself failed, leaving an empty preview URL for the downstream smoke job. Harden both preview and production deployment capture with `pipefail` and explicit `https://` URL validation, and include that invariant in the workflow policy tests.

## Change Boundaries

Use two sequential PRs:

1. Website search-index sanitization and focused regression tests.
2. Workflow action pins, token-permission narrowing, fail-closed Vercel deployment capture, and workflow-policy tests.

The changes do not alter public package APIs, React compatibility, the Node 24 toolchain, package module formats, or npm's OIDC-only publication path.

## Verification

The first PR runs its focused Vitest file, website tests/typecheck/lint/build, formatting, CodeQL in GitHub, and the required repository checks. The second PR runs focused workflow contract tests, the complete root test/typecheck/public-typecheck/performance-typecheck/lint/format/build/API/packaging/consumer/React compatibility/security audit/preflight lanes, GitHub's required checks, CodeQL, and Scorecard. After each merge, wait for the relevant default-branch runs for the merged commit before refreshing the API. For the workflow PR this includes main CI, Release, CodeQL, and Scorecard. With no changeset in the hardening PR, its Release run is a no-change runtime smoke of the workflow and OIDC preconditions; it cannot prove PAT write grants, a real npm OIDC exchange, or provenance. Those remain externally unverified until the next real release. Fixed alerts must close through new analysis, not manual dismissal.
