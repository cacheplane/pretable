"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import type { DensityHeights } from "@pretable/ui";

import { useDensityHeights } from "./useDensityHeights";

type Density = "compact" | "standard" | "spacious";

const DENSITIES: readonly Density[] = ["compact", "standard", "spacious"];

const FALLBACK: DensityHeights = { rowHeight: 32, headerHeight: 36 };

function parsePx(value: string): number | null {
  const match = value.trim().match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

function readScoped(root: HTMLElement | null): DensityHeights {
  if (!root) return FALLBACK;
  const styles = getComputedStyle(root);
  return {
    rowHeight:
      parsePx(styles.getPropertyValue("--pretable-row-height")) ??
      FALLBACK.rowHeight,
    headerHeight:
      parsePx(styles.getPropertyValue("--pretable-header-height")) ??
      FALLBACK.headerHeight,
  };
}

// The same shape as the unmodified `useDensityHeights` above, adapted to a
// scoped root: `getDensityHeights()` always reads `document.documentElement`,
// by design (see its own doc comment), so it cannot see an override on a
// wrapper element. A piece of UI that deliberately runs at its own density
// reads its own computed style directly instead, the way this hook does.
function useScopedDensityHeights(root: HTMLElement | null): DensityHeights {
  const cached = useRef<DensityHeights | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!root) return () => {};
      const observer = new MutationObserver(onChange);
      observer.observe(root, {
        attributes: true,
        attributeFilter: ["data-density"],
      });
      return () => observer.disconnect();
    },
    [root],
  );

  const getSnapshot = useCallback(() => {
    const next = readScoped(root);
    const prev = cached.current;
    if (
      prev !== null &&
      prev.rowHeight === next.rowHeight &&
      prev.headerHeight === next.headerHeight
    ) {
      return prev;
    }
    cached.current = next;
    return next;
  }, [root]);

  return useSyncExternalStore(subscribe, getSnapshot, () => FALLBACK);
}

export function DensityHeightsDemo() {
  const [density, setDensity] = useState<Density>("standard");
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const scoped = useScopedDensityHeights(wrapper);

  // The page's own `useDensityHeights`, unmodified — it reads
  // `document.documentElement`, this docs page's real root, which the
  // buttons below never touch.
  const page = useDensityHeights();

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        These buttons set <code>data-density</code> on the boxed wrapper below,
        not on <code>&lt;html&gt;</code> — a docs-site adaptation so this demo
        does not re-theme the rest of the page. &quot;Boxed wrapper&quot; reads
        that element&apos;s own computed style directly; &quot;Page root&quot;
        is read through the unmodified <code>useDensityHeights</code> hook above
        and stays constant no matter which button is pressed, because that hook
        only ever reads <code>document.documentElement</code>.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {DENSITIES.map((option) => (
          <button
            aria-pressed={option === density}
            key={option}
            onClick={() => setDensity(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <div
        data-density={density}
        ref={setWrapper}
        style={{
          background: "var(--pretable-bg-toolbar)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Reading</th>
              <th style={{ textAlign: "right" }}>Row height</th>
              <th style={{ textAlign: "right" }}>Header height</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Boxed wrapper (data-density=&quot;{density}&quot;)</td>
              <td style={{ textAlign: "right" }}>{scoped.rowHeight}px</td>
              <td style={{ textAlign: "right" }}>{scoped.headerHeight}px</td>
            </tr>
            <tr>
              <td>Page root (unaffected)</td>
              <td style={{ textAlign: "right" }}>{page.rowHeight}px</td>
              <td style={{ textAlign: "right" }}>{page.headerHeight}px</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
