import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import { AgGridAdapter } from "../ag-grid-adapter";
import { MuiAdapter } from "../mui-adapter";
import { PretableAdapter } from "../pretable-adapter";
import { TanstackAdapter } from "../tanstack-adapter";
import {
  scrollRuntimeProfiles,
  type ScrollRuntimeProfile,
} from "../bench-runtime";

/**
 * **The invariant: every selector the harness uses to find an adapter's
 * scrolling DOM must resolve against that adapter, mounted.**
 *
 * The defect. AG Grid 36 replaced the old multi-container body DOM with a
 * single scroller and deleted `.ag-body-viewport`, the selector
 * `scrollRuntimeProfiles` had used since v33. Nothing failed. `measureBenchScroll`
 * could not find a viewport, returned `status: "partial"` having scrolled
 * nothing, and reported an AG Grid that looked cheap because it had done no
 * work; `app.css` scoped `overflow-anchor: none` to the same dead class, so AG
 * Grid alone would have run with browser scroll anchoring enabled. The full CI
 * gate passed green on that commit (#306 fixed it after the fact).
 *
 * **Why the existing tests could not catch it, and this one can.** The jsdom
 * test that was meant to pin the selector built its own `.ag-body-viewport`
 * fixture with `document.body.innerHTML = ...` and asserted the harness read it
 * — faithfully pinning a contract the library had already deleted. A test that
 * constructs its own fixture for an external library's DOM can never detect
 * that library changing it. So this file mounts the REAL adapter, against the
 * real installed package, and reads the selectors out of
 * `scrollRuntimeProfiles` rather than restating them. `.ag-body-viewport` is
 * absent from AG Grid 36's rendered tree, so this test fails on the pre-#306
 * profile — the proof is in the PR that introduced it.
 *
 * **What jsdom can and cannot reach.** AG Grid and MUI both render their
 * virtualized row/cell tree under jsdom without real layout, so their full
 * profile — viewport, rows, cells, and the row-id/row-index attributes — is
 * checked live. TanStack does not: `@tanstack/react-virtual` renders zero rows
 * with a zero-height container, so only its viewport is reachable. That is the
 * honest limit, and {@link MOUNTS} records it per adapter rather than letting a
 * weaker check pass for a stronger one. It costs nothing here: TanStack's and
 * pretable's row markup is authored in this repo, so a change to it is a change
 * to a diff someone reviews — the failure mode this guard exists for is a
 * third-party bump, and both third parties are fully covered.
 *
 * **What makes it self-enforcing.** The adapter list is `scrollRuntimeProfiles`
 * itself. A new adapter added there with no entry in {@link MOUNTS} fails, so
 * DOM coverage cannot be skipped by omission, and the judgement an author is
 * not allowed to make is whether their adapter needs checking.
 */

const APP_CSS = path.join(__dirname, "..", "app.css");

/** How much of a profile is reachable by mounting under jsdom. */
type Coverage = "full" | "viewport-only";

interface AdapterMount {
  render: () => void;
  /**
   * `viewport-only` needs a written reason. It is the weaker check, and an
   * unexplained downgrade is how a guard quietly stops guarding.
   */
  coverage: Coverage;
  reason?: string;
}

function dataset() {
  return createScenarioDataset("S2", { scale: "smoke" });
}

const MOUNTS: Record<keyof typeof scrollRuntimeProfiles, AdapterMount> = {
  "ag-grid": {
    render: () => {
      render(<AgGridAdapter dataset={dataset()} runKey={0} />);
    },
    coverage: "full",
  },
  mui: {
    render: () => {
      render(<MuiAdapter dataset={dataset()} runKey={0} />);
    },
    coverage: "full",
  },
  tanstack: {
    render: () => {
      render(<TanstackAdapter dataset={dataset()} runKey={0} />);
    },
    coverage: "viewport-only",
    reason:
      "@tanstack/react-virtual measures the scroll container to decide what to " +
      "render, and jsdom reports every element as zero-height, so it renders no " +
      "rows at all. The row and cell selectors are attributes this repo writes " +
      "in tanstack-adapter.tsx, not TanStack's own markup, so no third-party " +
      "bump can move them.",
  },
  pretable: {
    render: () => {
      render(<PretableAdapter dataset={dataset()} runKey={0} />);
    },
    coverage: "full",
  },
};

/** First element matching `selector`, searched across every mounted container. */
function query(selector: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(selector);
}

function queryAll(selector: string): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(selector)];
}

describe("comparator DOM contract", () => {
  afterEach(() => {
    cleanup();
  });

  test("every adapter in scrollRuntimeProfiles is mounted by this file", () => {
    expect(Object.keys(MOUNTS).sort()).toEqual(
      Object.keys(scrollRuntimeProfiles).sort(),
    );

    for (const [adapterId, mount] of Object.entries(MOUNTS)) {
      if (mount.coverage === "viewport-only") {
        expect(
          mount.reason,
          `Adapter "${adapterId}" is checked at viewport-only coverage with no ` +
            "reason. Say why the rows are unreachable, or raise the coverage.",
        ).toBeTruthy();
      }
    }
  });

  for (const [adapterId, mount] of Object.entries(MOUNTS)) {
    const profile: ScrollRuntimeProfile =
      scrollRuntimeProfiles[adapterId as keyof typeof scrollRuntimeProfiles];

    // 30s ceiling: mounting MUI X DataGrid under jsdom is ~5.5-8s of real work
    // against vitest's 5s default — deterministically slow, not flaky. The
    // waitFor calls inside cap out well below it so a missing selector reports
    // its own diagnostic rather than a bare timeout.
    test(`${adapterId}: the mounted adapter answers to its own profile selectors`, async () => {
      mount.render();

      await waitFor(
        () => {
          expect(
            query(profile.viewportSelector),
            `Mounting the real ${adapterId} adapter produced no element matching ` +
              `its viewportSelector "${profile.viewportSelector}".\n\n` +
              "This is the failure the harness cannot see at run time: with no\n" +
              'viewport, measureBenchScroll returns status: "partial" having\n' +
              "scrolled nothing, and the adapter looks fast for having done no work.\n" +
              "Fix scrollRuntimeProfiles in bench-runtime.ts to name the element the\n" +
              "installed version actually scrolls, and update the matching rule in\n" +
              "app.css in the same change.",
          ).not.toBeNull();
        },
        // Comfortably under the test's own ceiling, so a missing selector
        // reports the diagnostic below instead of a bare vitest timeout.
        { timeout: 10_000 },
      );

      if (mount.coverage === "viewport-only") return;

      // Rows arrive a tick after the viewport in AG Grid, so they get their
      // own wait rather than a bare read.
      await waitFor(
        () => {
          expect(
            queryAll(profile.rowSelector).length,
            `${adapterId} rendered no element matching rowSelector ` +
              `"${profile.rowSelector}".`,
          ).toBeGreaterThan(0);
        },
        // Comfortably under the test's own ceiling, so a missing selector
        // reports the diagnostic below instead of a bare vitest timeout.
        { timeout: 10_000 },
      );

      const rows = queryAll(profile.rowSelector);

      expect(
        queryAll(profile.cellSelector).length,
        `${adapterId} rendered no element matching cellSelector ` +
          `"${profile.cellSelector}".`,
      ).toBeGreaterThan(0);
      expect(
        rows[0]!.getAttribute(profile.rowIndexAttribute),
        `${adapterId} rows carry no "${profile.rowIndexAttribute}" attribute. ` +
          "The harness reads it to detect blank gaps and to build the settle " +
          "signature; without it both silently measure nothing.",
      ).not.toBeNull();

      if (profile.rowIdAttribute) {
        expect(
          rows[0]!.getAttribute(profile.rowIdAttribute),
          `${adapterId} rows carry no "${profile.rowIdAttribute}" attribute.`,
        ).not.toBeNull();
      }
    }, 30_000);
  }

  test("app.css declares equal scroll conditions for exactly the profile viewports", () => {
    // Comments are stripped first, or this check passes on prose. The comment
    // above the rule in app.css names `.ag-body-viewport` while explaining why
    // it is gone — a raw substring search would have read that as coverage.
    const css = readFileSync(APP_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    for (const [adapterId, profile] of Object.entries(scrollRuntimeProfiles)) {
      expect(
        css.includes(profile.viewportSelector),
        `apps/bench/src/app.css has no rule mentioning "${profile.viewportSelector}", ` +
          `the viewport the harness scrolls for "${adapterId}".\n\n` +
          "app.css is where `overflow-anchor: none` and `overscroll-behavior: contain`\n" +
          "are applied. An adapter missing from it runs with browser scroll anchoring\n" +
          "ON while the others run with it off — an unequal measurement condition on\n" +
          "a metric the harness reports (scroll_anchor_shift_*). This is the second\n" +
          "half of what #306 broke: the profile and the CSS drifted apart silently.",
      ).toBe(true);
    }
  });
});
