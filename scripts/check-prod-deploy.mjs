#!/usr/bin/env node
// Decides whether production is out of date with `main`, and makes that
// decision loud.
//
// Why this exists: `Deploy → Vercel (production)` lists `test` in its `needs:`,
// so when any gate fails on a `main` push the deploy job is *skipped*. GitHub
// renders a skipped job as a grey check, and the run is already red from the
// gate that failed, so nothing distinguishes "main merged and CI eventually went
// green" from "production never got this commit". That happened on 2026-08-14
// (run 31806388257): one flaky `test` failure, `Deploy → Vercel (production)`
// skipped, pretable.ai served pre-#397 content for hours, and it was caught by
// accident.
//
// Branch protection cannot fix this. Required status checks only gate *merges
// into* `main`; a push-triggered run's failure blocks nothing and notifies
// no one reliably. So the signal has to be something that survives the run:
// a tracking issue, which lands in the Issues tab and sends a notification.
//
// Two modes, both of which end in the same issue:
//
//   --mode=run        In-run alarm. Reads the `deploy-prod` job result via
//                     `needs`, so it fires the moment a push to `main` does
//                     not deploy. Deterministic, no network.
//
//   --mode=freshness  Independent ground truth. Fetches `/version.json` off
//                     production and compares the commit it was built from
//                     against `main`'s head. Catches everything the in-run
//                     alarm structurally cannot: a whole run cancelled by
//                     `concurrency`, a manual Vercel rollback, an alias that
//                     silently kept pointing at the previous deployment.
//
// The decision functions are pure so they can be unit-tested; the process
// exits non-zero on alarm so the job is red as well as noisy.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Stable title. The issue is opened once and re-used (commented + reopened) so
 * a repeated outage does not shower the Issues tab with duplicates, and so
 * `--mode=run` and `--mode=freshness` converge on the same thread.
 */
export const ALARM_ISSUE_TITLE = "Production is out of date with `main`";

const SHORT_SHA_LENGTH = 7;
const DEFAULT_GRACE_MINUTES = 25;

/**
 * Compares two commit ids where either side may be abbreviated. Returns false
 * for empty/unknown values rather than treating them as a match — an unknown
 * live commit is a reason to alarm, never a reason to relax.
 */
export function isCommitId(value) {
  return (
    typeof value === "string" &&
    new RegExp(`^[0-9a-f]{${SHORT_SHA_LENGTH},40}$`).test(
      value.trim().toLowerCase(),
    )
  );
}

export function sameCommit(a, b) {
  if (!isCommitId(a) || !isCommitId(b)) return false;
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  const shortest = Math.min(left.length, right.length);
  return left.slice(0, shortest) === right.slice(0, shortest);
}

function shortSha(sha) {
  return typeof sha === "string" ? sha.slice(0, SHORT_SHA_LENGTH) : "unknown";
}

function commitLine({ repo, sha }) {
  return repo
    ? `https://github.com/${repo}/commit/${sha}`
    : `commit \`${sha}\``;
}

/**
 * In-run decision: did the production deploy actually run for this push?
 *
 * `deployResult` is the `needs.deploy-prod.result` string: one of `success`,
 * `failure`, `cancelled`, `skipped`. Anything unrecognised (including an empty
 * string, which is what a job that never reported produces) alarms — fail
 * loud, never fail open.
 */
export function evaluateDeployRun({
  deployResult,
  sha = "",
  actor = "",
  repo = "",
  runUrl = "",
} = {}) {
  const result = String(deployResult ?? "").trim();

  if (result === "success") {
    return {
      alarm: false,
      reason: "deployed",
      headline: `Production deploy succeeded for ${shortSha(sha)}.`,
    };
  }

  const reason =
    result === "skipped"
      ? "deploy-skipped"
      : result === "failure"
        ? "deploy-failed"
        : result === "cancelled"
          ? "deploy-cancelled"
          : "deploy-unknown";

  const explanation = {
    "deploy-skipped":
      "The deploy job was **skipped** — one of the gates it needs (`test`, `typecheck`, `lint`, `format`, `build`, `packaging`, `publish-preflight`, `api-report`, `examples-registry`) did not pass. GitHub renders that as a grey check, which is why this issue exists.",
    "deploy-failed":
      "The deploy job **failed**. Production may be serving either the previous commit or a half-deployed one — check the job log before assuming it is only the smoke test that broke.",
    "deploy-cancelled":
      "The deploy job was **cancelled** — most likely by `concurrency` when a newer push to `main` superseded this run. Confirm the newer run deployed; if it did not, production is stranded on an older commit.",
    "deploy-unknown": `The deploy job reported an unrecognised result (\`${result || "<empty>"}\`). Treating it as "did not deploy".`,
  }[reason];

  const headline = `Production did NOT deploy ${shortSha(sha)} (deploy job: ${result || "<empty>"}).`;

  return {
    alarm: true,
    reason,
    headline,
    body: [
      `**Production is not serving \`main\`.**`,
      "",
      `- Commit: ${commitLine({ repo, sha })}`,
      `- Deploy job result: \`${result || "<empty>"}\``,
      runUrl ? `- Run: ${runUrl}` : null,
      actor ? `- Pushed by: @${actor}` : null,
      "",
      explanation,
      "",
      "**What to do**",
      "",
      "1. Fix the failing gate, or re-run the failed jobs if it was a flake.",
      "2. Once the run is green, re-run `Deploy → Vercel (production)` (Actions → the run → *Re-run failed jobs*), or push a commit to `main`.",
      "3. This issue closes itself on the next successful production deploy.",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  };
}

/**
 * Ground-truth decision: is the commit production was built from the same one
 * `main` points at?
 *
 * `live` is the result of {@link readLiveVersion}. `headCommitIso` is the head
 * commit's committer date; a commit younger than `graceMinutes` is not yet
 * expected to be live, because a deploy legitimately takes several minutes.
 * Without that grace window this check would alarm on every healthy merge that
 * happened to race the schedule.
 */
export function evaluateProdFreshness({
  expectedSha = "",
  headCommitIso = null,
  live,
  now = new Date(),
  graceMinutes = DEFAULT_GRACE_MINUTES,
  siteUrl = "",
  repo = "",
} = {}) {
  if (live?.ok && sameCommit(live.commit, expectedSha)) {
    return {
      alarm: false,
      reason: "current",
      headline: `Production is serving ${shortSha(expectedSha)}.`,
    };
  }

  const headTime = headCommitIso ? Date.parse(headCommitIso) : Number.NaN;
  const ageMinutes = Number.isNaN(headTime)
    ? Number.POSITIVE_INFINITY
    : (now.getTime() - headTime) / 60_000;

  if (ageMinutes < graceMinutes) {
    return {
      alarm: false,
      reason: "within-grace",
      headline: `Production is behind, but ${shortSha(expectedSha)} is only ${ageMinutes.toFixed(1)}m old (grace: ${graceMinutes}m) — a deploy is plausibly still in flight.`,
    };
  }

  const reason = !live?.ok
    ? "site-unreachable"
    : isCommitId(live.commit)
      ? "stale"
      : "version-unknown";

  const explanation = {
    "site-unreachable": `Could not read \`${siteUrl}/version.json\`: ${live?.error ?? "unknown error"}. Either the site is down or the build stopped emitting the stamp.`,
    "version-unknown": `\`${siteUrl}/version.json\` came back without a usable commit (\`${live?.commit ?? "<missing>"}\`). The deploy build did not receive \`PRETABLE_COMMIT_SHA\`, so freshness can no longer be verified — that is a monitoring outage, not a green light.`,
    stale: `Production was built from \`${shortSha(live?.commit)}\`, but \`main\` is at \`${shortSha(expectedSha)}\`.`,
  }[reason];

  return {
    alarm: true,
    reason,
    headline: `Production is out of date with \`main\` (${reason}).`,
    body: [
      `**Production is not serving \`main\`.**`,
      "",
      `- \`main\` head: ${commitLine({ repo, sha: expectedSha })}`,
      `- Production reports: \`${live?.ok ? (live.commit ?? "<missing>") : "unreachable"}\``,
      headCommitIso
        ? `- Head commit age: ${Number.isFinite(ageMinutes) ? `${ageMinutes.toFixed(0)}m` : "unknown"}`
        : null,
      siteUrl ? `- Checked: ${siteUrl}/version.json` : null,
      "",
      explanation,
      "",
      "**What to do**",
      "",
      "1. Open the most recent `main` run in Actions and look at `Deploy → Vercel (production)`.",
      "2. If it is grey (skipped) or red, fix the gate and re-run it.",
      "3. If it is green, the alias did not move — check the Vercel dashboard for a rollback or a stuck alias.",
      "4. This issue closes itself once production reports `main`'s head commit.",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  };
}

/**
 * Reads the build stamp production serves. Never throws: a failed fetch is a
 * result, because "the site did not answer" is itself something to alarm on.
 */
export async function readLiveVersion(
  siteUrl,
  { fetchImpl = fetch, timeoutMs = 15_000 } = {},
) {
  const url = `${String(siteUrl).replace(/\/+$/, "")}/version.json`;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const payload = await response.json();
    return { ok: true, commit: payload?.commit, builtAt: payload?.builtAt };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

async function runGh(args) {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

/**
 * A machine-readable fingerprint of the current alarm, stored in the issue
 * body. The freshness monitor runs on a schedule, so without this it would
 * comment on the same open issue every half hour and train everyone to mute
 * the thread — the loudest possible way to become silent again.
 */
export function alarmMarker(decision, sha = "") {
  return `<!-- prod-alarm:${decision.reason}:${shortSha(sha)} -->`;
}

/**
 * Opens, updates, or closes the single tracking issue.
 *
 * Deliberately lists issues via `gh issue list --json` and matches the title in
 * JS rather than using `--search`: GitHub's search index lags by seconds to
 * minutes, and a stale index would make the alarm open a duplicate issue every
 * time it fired.
 */
export async function syncAlarmIssue({
  decision,
  repo,
  sha = "",
  dryRun = false,
  run = runGh,
  title = ALARM_ISSUE_TITLE,
}) {
  const listArgs = [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title,body",
  ];

  const actions = [];
  let open = [];
  try {
    open = JSON.parse((await run(listArgs)) || "[]");
  } catch (error) {
    // A dry run is exercised outside the repo's token scope (a scratch branch,
    // a local invocation), where listing issues legitimately fails. Anywhere
    // else, failing to read the issue list must surface.
    if (!dryRun) throw error;
    process.stdout.write(
      `[dry-run] could not list issues (${error?.message ?? error}); assuming none open\n`,
    );
  }
  const existing = open.find((issue) => issue.title === title);

  const marker = alarmMarker(decision, sha);
  const body = `${decision.headline}\n\n${decision.body ?? ""}\n\n${marker}`;

  if (decision.alarm) {
    if (!existing) {
      actions.push([
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        title,
        "--body",
        body,
      ]);
    } else if (String(existing.body ?? "").includes(marker)) {
      // Same failure, same commit — the issue already says exactly this.
      return { dryRun, actions, existing: existing.number, unchanged: true };
    } else {
      // The situation moved (new commit, or a different failure). Keep the
      // body current *and* comment, so the thread pings its subscribers.
      actions.push(
        [
          "issue",
          "edit",
          String(existing.number),
          "--repo",
          repo,
          "--body",
          body,
        ],
        [
          "issue",
          "comment",
          String(existing.number),
          "--repo",
          repo,
          "--body",
          body,
        ],
      );
    }
  } else if (existing) {
    actions.push([
      "issue",
      "close",
      String(existing.number),
      "--repo",
      repo,
      "--comment",
      `Recovered: ${decision.headline}`,
    ]);
  }

  if (dryRun) {
    return { dryRun: true, actions, existing: existing?.number ?? null };
  }

  for (const args of actions) {
    await run(args);
  }
  return { dryRun: false, actions, existing: existing?.number ?? null };
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) options[match[1]] = match[2] ?? "true";
  }
  return options;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const mode = options.mode ?? "run";
  const repo = env.GITHUB_REPOSITORY ?? "";
  const dryRun = options["dry-run"] === "true" || env.DRY_RUN === "1";

  const decision =
    mode === "freshness"
      ? evaluateProdFreshness({
          expectedSha: env.EXPECTED_SHA ?? env.GITHUB_SHA ?? "",
          headCommitIso: env.HEAD_COMMIT_ISO || null,
          live: await readLiveVersion(env.SITE_URL ?? ""),
          siteUrl: env.SITE_URL ?? "",
          graceMinutes: Number(env.GRACE_MINUTES ?? DEFAULT_GRACE_MINUTES),
          repo,
        })
      : evaluateDeployRun({
          deployResult: env.DEPLOY_RESULT ?? "",
          sha: env.GITHUB_SHA ?? "",
          actor: env.GITHUB_ACTOR ?? "",
          runUrl: env.RUN_URL ?? "",
          repo,
        });

  process.stdout.write(`${JSON.stringify({ mode, ...decision }, null, 2)}\n`);

  // The issue is the *signal*, but it is not the *verdict*. If filing it
  // throws, the job must still go red for an alarm — a broken notifier may
  // never quietly upgrade a bad deploy to a pass.
  try {
    const issue = await syncAlarmIssue({
      decision,
      repo,
      sha: env.EXPECTED_SHA || env.GITHUB_SHA || "",
      dryRun,
    });
    if (issue.dryRun) {
      process.stdout.write(
        `[dry-run] gh commands that would run:\n${
          issue.actions.length === 0
            ? "  (none)"
            : issue.actions.map((args) => `  gh ${args.join(" ")}`).join("\n")
        }\n`,
      );
    }
  } catch (error) {
    process.stdout.write(
      `Failed to sync the tracking issue: ${error?.message ?? error}\n`,
    );
    if (!decision.alarm) return 1;
  }

  if (env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `### ${decision.alarm ? "Production is NOT up to date" : "Production is up to date"}\n\n${decision.headline}\n\n${decision.body ?? ""}\n`,
    );
  }

  return decision.alarm ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
