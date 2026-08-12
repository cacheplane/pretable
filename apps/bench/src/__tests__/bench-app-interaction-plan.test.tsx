import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const pretableAdapterSpy = vi.hoisted(() => vi.fn());

vi.mock("../pretable-adapter", () => ({
  PretableAdapter: (props: unknown) => {
    pretableAdapterSpy(props);
    return <div data-testid="pretable-adapter" />;
  },
}));

import { BenchApp } from "../bench-app";

describe("BenchApp interaction planning", () => {
  afterEach(() => {
    cleanup();
    pretableAdapterSpy.mockClear();
  });

  test("does not pre-apply sort interaction state before a run starts", () => {
    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2&scale=dev&script=sort"
        browserVersion="123.0"
      />,
    );

    expect(pretableAdapterSpy).toHaveBeenCalled();
    expect(pretableAdapterSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      interactionPlan: null,
    });
  });

  test("does not pre-apply the resident window before a replace run starts", () => {
    // `initialRows` narrows the surface to the run's resident window. Applying it
    // at idle would make the lab page a different grid from the one every other
    // script measures.
    render(
      <BenchApp
        search="?adapter=pretable&scenario=S1&scale=dev&script=replace"
        browserVersion="123.0"
      />,
    );

    expect(pretableAdapterSpy).toHaveBeenCalled();
    expect(pretableAdapterSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      initialRows: undefined,
      interactionPlan: null,
    });
  });

  test("does not pre-apply the grouping before a group run starts", () => {
    // `group` measures the grouping being applied, so the grid must still be
    // ungrouped when the run begins. (`group-expand` is the opposite — see
    // bench-app.test.tsx.)
    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2&scale=dev&script=group"
        browserVersion="123.0"
      />,
    );

    expect(pretableAdapterSpy).toHaveBeenCalled();
    expect(pretableAdapterSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      interactionPlan: null,
    });
  });
});
