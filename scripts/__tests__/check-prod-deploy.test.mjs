import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  ALARM_ISSUE_TITLE,
  alarmMarker,
  evaluateDeployRun,
  evaluateProdFreshness,
  readLiveVersion,
  sameCommit,
  syncAlarmIssue,
} from "../check-prod-deploy.mjs";

const SHA = "a9ee55f45313ea9e4561bef11d7b9ebe9d6e9ab9";
const OTHER_SHA = "0123456789abcdef0123456789abcdef01234567";

async function startServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function fakeGh(openIssues) {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args);
      if (args[1] === "list") return JSON.stringify(openIssues);
      return "";
    },
  };
}

test("a successful deploy is not an alarm", () => {
  const decision = evaluateDeployRun({ deployResult: "success", sha: SHA });
  assert.equal(decision.alarm, false);
  assert.equal(decision.reason, "deployed");
});

test("a skipped deploy alarms — this is the 2026-08-14 failure mode", () => {
  const decision = evaluateDeployRun({
    deployResult: "skipped",
    sha: SHA,
    actor: "blove",
    repo: "cacheplane/pretable",
    runUrl: "https://github.com/cacheplane/pretable/actions/runs/31806388257",
  });
  assert.equal(decision.alarm, true);
  assert.equal(decision.reason, "deploy-skipped");
  assert.match(decision.headline, /did NOT deploy a9ee55f/);
  // The body has to carry enough to act on without opening the run.
  assert.match(decision.body, /31806388257/);
  assert.match(decision.body, /@blove/);
  assert.match(decision.body, new RegExp(SHA));
});

test("a failed deploy alarms", () => {
  const decision = evaluateDeployRun({ deployResult: "failure", sha: SHA });
  assert.equal(decision.alarm, true);
  assert.equal(decision.reason, "deploy-failed");
});

test("a cancelled deploy alarms — concurrency can cancel a main run mid-deploy", () => {
  const decision = evaluateDeployRun({ deployResult: "cancelled", sha: SHA });
  assert.equal(decision.alarm, true);
  assert.equal(decision.reason, "deploy-cancelled");
});

test("an empty or unrecognised deploy result fails loud, not open", () => {
  for (const deployResult of ["", undefined, "  ", "Success", "weird"]) {
    const decision = evaluateDeployRun({ deployResult, sha: SHA });
    assert.equal(
      decision.alarm,
      true,
      `expected an alarm for ${JSON.stringify(deployResult)}`,
    );
    assert.equal(decision.reason, "deploy-unknown");
  }
});

test("freshness: production serving main's head is not an alarm", () => {
  const decision = evaluateProdFreshness({
    expectedSha: SHA,
    headCommitIso: "2026-08-14T13:00:00Z",
    live: { ok: true, commit: SHA },
    now: new Date("2026-08-14T18:00:00Z"),
  });
  assert.equal(decision.alarm, false);
  assert.equal(decision.reason, "current");
});

test("freshness: an abbreviated live sha still matches", () => {
  const decision = evaluateProdFreshness({
    expectedSha: SHA,
    live: { ok: true, commit: SHA.slice(0, 7) },
    now: new Date("2026-08-14T18:00:00Z"),
  });
  assert.equal(decision.alarm, false);
});

test("freshness: a stale production commit alarms once the grace window passes", () => {
  const decision = evaluateProdFreshness({
    expectedSha: SHA,
    headCommitIso: "2026-08-14T13:47:00Z",
    live: { ok: true, commit: OTHER_SHA },
    now: new Date("2026-08-14T16:00:00Z"),
    siteUrl: "https://pretable.ai",
  });
  assert.equal(decision.alarm, true);
  assert.equal(decision.reason, "stale");
  assert.match(decision.body, /0123456/);
  assert.match(decision.body, /a9ee55f/);
});

test("freshness: a just-merged commit is inside the grace window, not an alarm", () => {
  const decision = evaluateProdFreshness({
    expectedSha: SHA,
    headCommitIso: "2026-08-14T13:47:00Z",
    live: { ok: true, commit: OTHER_SHA },
    now: new Date("2026-08-14T13:52:00Z"),
    graceMinutes: 25,
  });
  assert.equal(decision.alarm, false);
  assert.equal(decision.reason, "within-grace");
});

test("freshness: grace applies only to age — a current deploy never needs it", () => {
  // Mutation guard: if `within-grace` were checked before the match, a healthy
  // fresh deploy would report the wrong reason.
  const decision = evaluateProdFreshness({
    expectedSha: SHA,
    headCommitIso: "2026-08-14T13:47:00Z",
    live: { ok: true, commit: SHA },
    now: new Date("2026-08-14T13:48:00Z"),
  });
  assert.equal(decision.reason, "current");
});

test("freshness: an unknown head commit date does not buy grace forever", () => {
  const decision = evaluateProdFreshness({
    expectedSha: SHA,
    headCommitIso: null,
    live: { ok: true, commit: OTHER_SHA },
    now: new Date("2026-08-14T13:48:00Z"),
  });
  assert.equal(decision.alarm, true);
  assert.equal(decision.reason, "stale");
});

test("freshness: an unreachable site alarms", () => {
  const decision = evaluateProdFreshness({
    expectedSha: SHA,
    headCommitIso: "2026-08-14T10:00:00Z",
    live: { ok: false, error: "HTTP 500" },
    now: new Date("2026-08-14T18:00:00Z"),
    siteUrl: "https://pretable.ai",
  });
  assert.equal(decision.alarm, true);
  assert.equal(decision.reason, "site-unreachable");
  assert.match(decision.body, /HTTP 500/);
});

test("freshness: a missing commit stamp alarms rather than passing vacuously", () => {
  for (const commit of [undefined, "", "unknown", null]) {
    const decision = evaluateProdFreshness({
      expectedSha: SHA,
      headCommitIso: "2026-08-14T10:00:00Z",
      live: { ok: true, commit },
      now: new Date("2026-08-14T18:00:00Z"),
    });
    assert.equal(decision.alarm, true, `expected an alarm for ${commit}`);
    assert.equal(decision.reason, "version-unknown");
  }
});

test("sameCommit refuses to match on empty or too-short values", () => {
  assert.equal(sameCommit("", ""), false);
  assert.equal(sameCommit(SHA, ""), false);
  assert.equal(sameCommit(SHA, "a9ee5"), false);
  assert.equal(sameCommit(SHA, SHA.toUpperCase()), true);
  assert.equal(sameCommit(SHA, OTHER_SHA), false);
});

test("readLiveVersion parses the served stamp", async (t) => {
  const base = await startServer(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ commit: SHA, builtAt: "2026-08-14" }));
  });
  const live = await readLiveVersion(base);
  assert.deepEqual(live, { ok: true, commit: SHA, builtAt: "2026-08-14" });
});

test("readLiveVersion reports a non-200 rather than throwing", async (t) => {
  const base = await startServer(t, (_request, response) => {
    response.writeHead(404);
    response.end("nope");
  });
  const live = await readLiveVersion(`${base}/`);
  assert.deepEqual(live, { ok: false, error: "HTTP 404" });
});

test("readLiveVersion reports unparseable JSON rather than throwing", async (t) => {
  const base = await startServer(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("<html>a Vercel error page</html>");
  });
  const live = await readLiveVersion(base);
  assert.equal(live.ok, false);
  assert.ok(live.error);
});

test("readLiveVersion requests /version.json off the given origin", async (t) => {
  const seen = [];
  const base = await startServer(t, (request, response) => {
    seen.push(request.url);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ commit: SHA }));
  });
  await readLiveVersion(`${base}///`);
  assert.deepEqual(seen, ["/version.json"]);
});

test("an alarm with no open issue creates one", async () => {
  const gh = fakeGh([]);
  const decision = evaluateDeployRun({ deployResult: "skipped", sha: SHA });
  await syncAlarmIssue({
    decision,
    repo: "cacheplane/pretable",
    run: gh.run,
  });
  const create = gh.calls.find((args) => args[1] === "create");
  assert.ok(create, "expected an issue to be created");
  assert.equal(create[create.indexOf("--title") + 1], ALARM_ISSUE_TITLE);
  assert.match(create[create.indexOf("--body") + 1], /did NOT deploy/);
});

test("a *different* alarm on an open issue comments instead of duplicating", async () => {
  const decision = evaluateDeployRun({ deployResult: "failure", sha: SHA });
  const gh = fakeGh([
    {
      number: 42,
      title: ALARM_ISSUE_TITLE,
      // Same issue, but it was opened for an older commit.
      body: `stale text ${alarmMarker(decision, OTHER_SHA)}`,
    },
  ]);
  await syncAlarmIssue({
    decision,
    repo: "cacheplane/pretable",
    sha: SHA,
    run: gh.run,
  });
  assert.equal(
    gh.calls.some((args) => args[1] === "create"),
    false,
    "must not open a second issue",
  );
  const comment = gh.calls.find((args) => args[1] === "comment");
  assert.ok(comment, "a changed situation must ping the thread");
  assert.equal(comment[2], "42");
  const edit = gh.calls.find((args) => args[1] === "edit");
  assert.ok(edit, "the issue body must be kept current");
  assert.match(edit[edit.indexOf("--body") + 1], /a9ee55f/);
});

test("the same alarm for the same commit is not re-announced", async () => {
  // The freshness monitor runs on a schedule; re-commenting every half hour
  // would train everyone to mute the thread.
  const decision = evaluateProdFreshness({
    expectedSha: SHA,
    headCommitIso: "2026-08-14T10:00:00Z",
    live: { ok: true, commit: OTHER_SHA },
    now: new Date("2026-08-14T18:00:00Z"),
  });
  const gh = fakeGh([
    {
      number: 42,
      title: ALARM_ISSUE_TITLE,
      body: `already reported\n\n${alarmMarker(decision, SHA)}`,
    },
  ]);
  const result = await syncAlarmIssue({
    decision,
    repo: "cacheplane/pretable",
    sha: SHA,
    run: gh.run,
  });
  assert.equal(result.unchanged, true);
  assert.deepEqual(
    gh.calls.map((args) => args[1]),
    ["list"],
    "a repeat of the same alarm must not write anything",
  );
});

test("the marker distinguishes both the reason and the commit", () => {
  const skipped = evaluateDeployRun({ deployResult: "skipped", sha: SHA });
  const failed = evaluateDeployRun({ deployResult: "failure", sha: SHA });
  assert.notEqual(alarmMarker(skipped, SHA), alarmMarker(failed, SHA));
  assert.notEqual(alarmMarker(skipped, SHA), alarmMarker(skipped, OTHER_SHA));
  assert.equal(alarmMarker(skipped, SHA), alarmMarker(skipped, SHA));
});

test("unrelated open issues do not suppress the alarm", async () => {
  const gh = fakeGh([
    { number: 7, title: "Something else entirely" },
    { number: 8, title: `${ALARM_ISSUE_TITLE} (old)` },
  ]);
  await syncAlarmIssue({
    decision: evaluateDeployRun({ deployResult: "skipped", sha: SHA }),
    repo: "cacheplane/pretable",
    run: gh.run,
  });
  assert.ok(gh.calls.find((args) => args[1] === "create"));
});

test("recovery closes the open issue", async () => {
  const gh = fakeGh([{ number: 42, title: ALARM_ISSUE_TITLE }]);
  await syncAlarmIssue({
    decision: evaluateDeployRun({ deployResult: "success", sha: SHA }),
    repo: "cacheplane/pretable",
    run: gh.run,
  });
  const close = gh.calls.find((args) => args[1] === "close");
  assert.ok(close, "expected the issue to be closed");
  assert.equal(close[2], "42");
});

test("a healthy deploy with no open issue touches nothing", async () => {
  const gh = fakeGh([]);
  await syncAlarmIssue({
    decision: evaluateDeployRun({ deployResult: "success", sha: SHA }),
    repo: "cacheplane/pretable",
    run: gh.run,
  });
  assert.deepEqual(
    gh.calls.map((args) => args[1]),
    ["list"],
  );
});

test("a dry run plans the gh commands without running them", async () => {
  const gh = fakeGh([]);
  const result = await syncAlarmIssue({
    decision: evaluateDeployRun({ deployResult: "skipped", sha: SHA }),
    repo: "cacheplane/pretable",
    dryRun: true,
    run: gh.run,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.actions.length, 1);
  assert.deepEqual(
    gh.calls.map((args) => args[1]),
    ["list"],
    "a dry run may read, but must not write",
  );
});

test("a failure to list issues surfaces outside a dry run", async () => {
  await assert.rejects(
    syncAlarmIssue({
      decision: evaluateDeployRun({ deployResult: "skipped", sha: SHA }),
      repo: "cacheplane/pretable",
      run: async () => {
        throw new Error("gh: not authenticated");
      },
    }),
    /not authenticated/,
  );
});
