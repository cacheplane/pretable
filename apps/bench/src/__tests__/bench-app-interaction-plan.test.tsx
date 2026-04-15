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
});
