// The build stamp production serves.
//
// This exists so something outside the CI run can answer "is pretable.ai
// actually serving `main`?" — see `scripts/check-prod-deploy.mjs`. On
// 2026-08-14 a flaky `test` skipped the production deploy, main moved on, and
// the site served the previous commit for hours with no signal anywhere. A run
// can be cancelled, a deploy can be rolled back in the Vercel dashboard, an
// alias can fail to move; none of those leave a trace in Actions. A commit id
// served by production does.
//
// `force-static` bakes this at build time, which is the point: the value has to
// describe the build, not the request. The deploy workflow passes the pushed
// commit in as `PRETABLE_COMMIT_SHA`.
export const dynamic = "force-static";

const commit =
  process.env.PRETABLE_COMMIT_SHA ??
  // Set by Vercel for git-linked deployments. Ours are CLI deployments from
  // GitHub Actions, so this is a fallback, not the main path.
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  // Deliberately not an empty string: the monitor treats a non-sha as
  // "freshness can no longer be verified" and alarms. A build that loses the
  // stamp must be noisy, not quietly unverifiable.
  "unknown";

const builtAt = new Date().toISOString();

export async function GET() {
  return Response.json(
    { commit, builtAt },
    {
      headers: {
        // Every deployment has its own copy of this file, but say it anyway:
        // a cached stamp read as the live one would make a stale production
        // look current, which is the exact failure this endpoint exists to
        // catch.
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
