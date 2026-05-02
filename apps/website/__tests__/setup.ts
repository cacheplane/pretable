import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom does not implement IntersectionObserver; ScrollReveal uses it.
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
  root = null;
  rootMargin = "";
  thresholds = [];
}
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

// Stub requestAnimationFrame / cancelAnimationFrame so animation loops in
// components (e.g. HeroGrid's replay engine) do not fire during unit tests.
// Without this, Vitest's jsdom environment flushes rAF synchronously, causing
// rapid-fire state updates that hit React's "Maximum update depth exceeded".
let rafId = 0;
globalThis.requestAnimationFrame = vi.fn((_cb: FrameRequestCallback) => {
  return ++rafId;
});
globalThis.cancelAnimationFrame = vi.fn();

// Explicit cleanup after each test to ensure the DOM is cleared.
// This is needed because the rAF mock prevents React from completing
// all scheduled work, which can cause Testing Library's auto-cleanup
// to leave stale DOM between tests.
afterEach(() => {
  cleanup();
});
