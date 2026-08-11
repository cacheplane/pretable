# Tombstoned Release Preflight Design

## Context

The fixed public package release failed while publishing
`@pretable/stream-adapter@0.1.0`. That version had previously been published and
then withdrawn. npm's package metadata no longer listed it under `versions`, but
still retained a `time["0.1.0"]` entry. npm permanently reserves a published
name/version pair even after withdrawal, so a second publish received
`E400 Cannot publish over previously published version`.

The repository preflight currently reads only the packument's `versions` keys.
It therefore classifies any local version absent from `versions` as an
unpublished same-batch candidate. That classification conflates two materially
different states:

- a version that has never been published and is eligible for the next batch;
- a withdrawn version that is no longer installable but can never be reused.

The release was recovered by advancing the fixed public package group to fresh
versions. This change prevents the same class of partial release before the
publish command begins and corrects the stream-adapter changelog's outdated
account of the affected versions.

## Goals

- Reject a local public package version that registry metadata identifies as
  previously published but that is no longer active.
- Preserve the existing behavior for genuinely new versions, currently
  published versions, registry failures, and dependency validation.
- Keep withdrawn versions from satisfying dependency ranges.
- Produce an error that names the exact package and version and tells the
  operator to choose a new version.
- Record the actual `@pretable/stream-adapter` `0.1.0`, `0.1.1`, and `0.2.0`
  release history without changing runtime or package APIs.

## Non-goals

- Reimplement Changesets publication or add a second publish mechanism.
- Attempt to restore or reuse `0.1.0`, or publish or tag the abandoned `0.1.1`
  repository assignment.
- Change fixed-group version policy, registry authentication, or trusted
  publishing.
- Treat withdrawn versions as valid dependency targets.
- Make release decisions from a hard-coded package/version denylist.
- Add a Changeset for this maintenance-only script, test, and historical
  changelog correction.

## Approaches Considered

### 1. Read active and historical versions from the packument (selected)

Continue using `metadata.versions` as the source of installable versions, and
also inspect semantic-version keys in `metadata.time` to detect versions the
registry has seen before. This uses the same registry response already fetched,
blocks the observed failure before publishing, and leaves dependency semantics
unchanged.

The limitation is that `time` is an npm packument convention rather than a
portable guarantee for every custom registry. The parser will therefore use it
when supplied and remain compatible with registries that omit it.

### 2. Probe each exact package/version endpoint

An additional `npm view <name>@<version>`-style request reliably finds active
versions, but a 404 cannot distinguish a genuinely new version from a withdrawn
one. It does not solve the failure without another historical signal and adds
network requests.

### 3. Maintain a local denylist of withdrawn versions

A denylist would block this one incident but would drift from registry state,
require manual updates after every withdrawal, and fail to protect other
packages. It is intentionally rejected.

## Registry State Model

Rename the internal registry reader to reflect that it returns package state
rather than one array. Each successful packument produces:

```js
{
  activeVersions: Set<string>,
  historicalVersions: Set<string>
}
```

`activeVersions` contains the keys of `metadata.versions`. These are the only
versions permitted to satisfy dependency ranges.

`historicalVersions` contains only semantic-version keys from `metadata.time`.
The semantic-version filter excludes packument bookkeeping keys such as
`created` and `modified`. It is used only to determine whether an inactive
local version is permanently reserved.

Registry responses retain the existing error behavior with these additions:

- HTTP 404 returns empty active and historical sets.
- `versions` remains required to be an object on a successful response.
- An omitted `time` property is accepted and yields an empty historical set,
  preserving compatibility with registries that do not expose npm history.
- If `time` is present, it must be a plain object. A malformed value fails
  closed with package context rather than silently disabling the guard.
- Timeouts, non-404 HTTP errors, and invalid JSON continue to reject the
  preflight.

A 404 or an omitted `time` property means the registry exposes no usable
history. The guard cannot detect a withdrawn version after an entire package is
removed or when a registry suppresses historical timestamps. Those cases remain
indistinguishable from a never-published package without a separate durable
ledger and are outside this incident's scope.

The existing per-package promise cache stores the whole state object, so the
change adds no registry requests.

## Package Classification and Data Flow

For every local public package, the preflight compares its exact local version
with the cached registry state:

| Active | Historical | Classification                             |
| ------ | ---------- | ------------------------------------------ |
| yes    | either     | already published; not in the batch        |
| no     | yes        | withdrawn/tombstoned; reject the preflight |
| no     | no         | genuinely new; include in the same batch   |

The preflight collects all tombstoned local package/version pairs, sorts them
for deterministic output, and rejects before dependency-edge validation or the
publish subprocess. The message must state that each exact version was
previously published and is no longer active, cannot be reused, and requires a
new version.

If no tombstones exist, dependency validation proceeds as it does today:

1. Resolve each public package's `@pretable/*` dependency specification.
2. Satisfy it from `activeVersions` when an installable version matches.
3. Otherwise satisfy it only from a genuinely new, non-private same-batch local
   package whose version matches.
4. Report the existing dependency violation when neither source satisfies it.

Historical versions never participate in step 2. A withdrawn external version
therefore remains unavailable, and a withdrawn local version is stopped earlier
by package classification.

## Test Design

The local registry fixture will support an explicit packument shape for new
tests while preserving the existing active-version shorthand. Tests must cover
the three classification rows directly:

1. **Withdrawn local version:** `versions` omits the local version while `time`
   contains it. The focused test begins red on the current implementation and
   then asserts rejection, the exact package/version, prior-publication wording,
   non-reusability, and guidance to choose a new version.
2. **Genuinely new local version:** both registry sets omit the local version.
   The result includes it in `sameBatchPackageCount` and accepts a matching
   local dependency.
3. **Currently published local version:** both sets may contain the local
   version, but membership in `versions` wins. The result does not count it as a
   same-batch package and the preflight succeeds.

Additional regressions will assert that:

- a non-local `@pretable/*` dependency whose only satisfying version appears in
  `time` fails with the existing dependency-unavailable error, not a local
  tombstone error;
- a present but malformed `time` value fails with registry/package context;
- omission of `time` preserves existing custom-registry behavior;
- the publish wrapper still never invokes Changesets when preflight rejects.

The implementation follows test-first development: observe the tombstone
regression fail against the current reader, implement the minimal state model,
then run the focused release-script tests before the full repository gate.

## Changelog Correction

`packages/stream-adapter/CHANGELOG.md` currently contains two `0.1.0` headings
and says the withdrawn version remains available as a deprecated registry
release. The correction will preserve generated release notes while making the
history factual:

- remove the duplicate empty `0.1.0` heading;
- mark `0.1.1` as a repository version assignment that was never published;
- state that `0.2.0` was the next published stream-adapter version after that
  abandoned assignment;
- update the historical `0.1.0` entry to say it was published, withdrawn, is no
  longer installable, and cannot be reused;
- remove the stale note claiming `0.1.0` remains on the registry as a deprecated
  release.

This is a correction of release history, not a new package change. Existing
feature and dependency notes remain intact.

## Rollout and Verification

The pull request contains only the preflight implementation, its tests, the
stream-adapter changelog correction, and the approved design/plan documents. It
does not include a Changeset because it changes no published runtime, public
API, or package artifact behavior.
`packages/stream-adapter/package.json` publishes only `dist`, so the historical
changelog correction is not part of the npm artifact.

Verification includes:

- focused release-script tests, including an explicit red/green tombstone
  control;
- the root test, typecheck, lint, build, API-report, packaging, publish-preflight,
  formatting, and diff gates used by CI;
- live-registry preflight against the current workspace versions;
- confirmation that Changesets status reports no new release from this branch;
- a clean final worktree and independent code/spec review before publication of
  the pull request.

The hardening is successful when a tombstoned exact local version fails before
the publish subprocess, a never-published version remains eligible, an active
version remains a no-op, and all existing dependency-preflight behavior stays
green.
