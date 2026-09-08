import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { composeRefs, useComposedRefs } from "../components/compose-refs";

it("returns void and implements React 18 null detach for mixed refs exactly once", () => {
  const own = createRef<HTMLButtonElement>();
  const consumerObject = createRef<HTMLButtonElement>();
  const dispose = vi.fn();
  const consumerCleanup = vi.fn<(node: HTMLButtonElement | null) => () => void>(
    () => dispose,
  );
  const consumerVoid = vi.fn<(node: HTMLButtonElement | null) => void>(
    () => {},
  );
  const ref = composeRefs(
    own,
    consumerObject,
    consumerCleanup,
    consumerVoid,
    null,
    undefined,
  );
  const node = document.createElement("button");
  expect(ref(node)).toBeUndefined();
  expect(own.current).toBe(node);
  expect(consumerObject.current).toBe(node);
  expect(ref(null)).toBeUndefined();
  expect(ref(null)).toBeUndefined();
  expect(own.current).toBeNull();
  expect(consumerObject.current).toBeNull();
  expect(dispose).toHaveBeenCalledOnce();
  expect(consumerCleanup).toHaveBeenCalledExactlyOnceWith(node);
  expect(consumerVoid.mock.calls).toEqual([[node], [null]]);
  ref(node);
  ref(null);
  expect(dispose).toHaveBeenCalledTimes(2);
});
it("keeps hook callback identity stable while both refs remain stable", () => {
  const own = createRef<HTMLButtonElement>();
  const consumer = vi.fn();
  const replacement = vi.fn();
  const { result, rerender, unmount } = renderHook(
    ({ ref }) => useComposedRefs(own, ref),
    { initialProps: { ref: consumer } },
  );
  const first = result.current;
  rerender({ ref: consumer });
  expect(result.current).toBe(first);
  rerender({ ref: replacement });
  expect(result.current).not.toBe(first);
  unmount();
});
