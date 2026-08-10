import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useResolvedHeights, useResolvedPx } from "../density";

function DensityProbe() {
  const { rowHeight, headerHeight } = useResolvedHeights();
  const panelHeight = useResolvedPx("--pretable-group-panel-height", 36);

  return <output>{`${rowHeight}:${headerHeight}:${panelHeight}`}</output>;
}

function HeightsProbe({ rowHeight }: { rowHeight: number }) {
  const heights = useResolvedHeights(rowHeight);

  return <output>{`${heights.rowHeight}:${heights.headerHeight}`}</output>;
}

let originalHtmlStyle: string | null = null;

beforeEach(() => {
  originalHtmlStyle = document.documentElement.getAttribute("style");
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalHtmlStyle === null) {
    document.documentElement.removeAttribute("style");
  } else {
    document.documentElement.setAttribute("style", originalHtmlStyle);
  }
});

test("hydrates theme geometry without a recovery when server markup used fallbacks", async () => {
  vi.stubGlobal("document", undefined);
  let serverMarkup: string;
  try {
    serverMarkup = renderToString(<DensityProbe />);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(serverMarkup!).toContain("32:36:36");

  document.documentElement.style.setProperty("--pretable-row-height", "48px");
  document.documentElement.style.setProperty(
    "--pretable-header-height",
    "52px",
  );
  document.documentElement.style.setProperty(
    "--pretable-group-panel-height",
    "44px",
  );

  const recoverableErrors: unknown[] = [];
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  try {
    const mountedContainer = document.createElement("div");
    container = mountedContainer;
    document.body.append(mountedContainer);
    mountedContainer.innerHTML = serverMarkup!;

    await act(async () => {
      root = hydrateRoot(mountedContainer, <DensityProbe />, {
        onRecoverableError(error) {
          recoverableErrors.push(error);
        },
      });
    });

    expect(mountedContainer.textContent).toBe("48:52:44");
    expect(recoverableErrors).toEqual([]);
  } finally {
    try {
      if (root) {
        await act(async () => {
          root!.unmount();
        });
      }
    } finally {
      container?.remove();
    }
  }
});

test("hydrates a row-height override without recovering the CSS header height", async () => {
  vi.stubGlobal("document", undefined);
  let serverMarkup: string;
  try {
    serverMarkup = renderToString(<HeightsProbe rowHeight={77} />);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(serverMarkup!).toContain("77:36");

  document.documentElement.style.setProperty("--pretable-row-height", "48px");
  document.documentElement.style.setProperty(
    "--pretable-header-height",
    "52px",
  );

  const recoverableErrors: unknown[] = [];
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  try {
    const mountedContainer = document.createElement("div");
    container = mountedContainer;
    document.body.append(mountedContainer);
    mountedContainer.innerHTML = serverMarkup!;

    await act(async () => {
      root = hydrateRoot(mountedContainer, <HeightsProbe rowHeight={77} />, {
        onRecoverableError(error) {
          recoverableErrors.push(error);
        },
      });
    });

    expect(mountedContainer.textContent).toBe("77:52");
    expect(recoverableErrors).toEqual([]);
  } finally {
    try {
      if (root) {
        await act(async () => {
          root!.unmount();
        });
      }
    } finally {
      container?.remove();
    }
  }
});
