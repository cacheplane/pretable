// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test, vi } from "vitest";

import { useDisposeOnUnmount } from "../use-dispose-on-unmount";

function Host({ disposable }: { disposable: { dispose: () => void } }) {
  useDisposeOnUnmount(disposable);
  return <div data-testid="host" />;
}

/** Lets the deferred disposal's microtask run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("useDisposeOnUnmount", () => {
  test("survives a StrictMode remount without disposing", async () => {
    // The failure this hook exists for: StrictMode's rehearsal unmount running
    // a plain `() => resource.dispose()` cleanup against a resource the remount
    // is about to keep using. In pretable that meant a disposed row-layout
    // controller thrown out of a layout effect and a blank grid in dev (#382).
    const disposable = { dispose: vi.fn() };
    render(
      <StrictMode>
        <Host disposable={disposable} />
      </StrictMode>,
    );
    await flush();

    expect(disposable.dispose).not.toHaveBeenCalled();
  });

  test("disposes on a real unmount", async () => {
    // The other half: deferral must not become a leak.
    const disposable = { dispose: vi.fn() };
    const { unmount } = render(<Host disposable={disposable} />);
    await flush();
    expect(disposable.dispose).not.toHaveBeenCalled();

    unmount();
    await flush();
    expect(disposable.dispose).toHaveBeenCalledTimes(1);
  });

  test("disposes the resource it is replacing, and keeps the new one", async () => {
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    const { rerender } = render(<Host disposable={first} />);
    await flush();

    rerender(<Host disposable={second} />);
    await flush();

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
  });

  test("accepts null without disposing anything", async () => {
    const { unmount } = render(<Host disposable={null as never} />);
    await flush();
    expect(() => unmount()).not.toThrow();
  });
});
