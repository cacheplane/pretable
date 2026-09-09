import { JSDOM } from "jsdom";
import { createElement, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import {
  PretableBadge,
  PretableOverlayProvider,
  PretableCheckbox,
  PretableSelect,
  PretableTextInput,
  PretableTextarea,
} from "@pretable/react";

function CompatibilityApp() {
  const [count, setCount] = useState(0);
  return createElement(
    "button",
    {
      "data-count": String(count),
      onClick: () => setCount((value) => value + 1),
      type: "button",
    },
    createElement(PretableBadge, { tone: "positive" }, "Ready"),
    createElement("span", { "data-value": "" }, String(count)),
  );
}

const serverMarkup = renderToString(createElement(CompatibilityApp));
if (
  !serverMarkup.includes("Ready") ||
  !serverMarkup.includes('data-count="0"')
) {
  throw new Error(`Unexpected server markup: ${serverMarkup}`);
}

const dom = new JSDOM(`<div id="root">${serverMarkup}</div>`, {
  pretendToBeVisual: true,
  url: "https://pretable.invalid/",
});
const previousGlobals = new Map();
for (const [name, value] of Object.entries({
  Event: dom.window.Event,
  HTMLElement: dom.window.HTMLElement,
  MouseEvent: dom.window.MouseEvent,
  Node: dom.window.Node,
  document: dom.window.document,
  navigator: dom.window.navigator,
  window: dom.window,
})) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
}

const recoverableErrors = [];
const unexpectedErrors = [];
const onError = (event) => {
  unexpectedErrors.push(String(event.error ?? event.message ?? event));
};
dom.window.addEventListener("error", onError);
const onUnhandledRejection = (reason) => unexpectedErrors.push(String(reason));
process.on("unhandledRejection", onUnhandledRejection);

const container = dom.window.document.getElementById("root");
const root = hydrateRoot(container, createElement(CompatibilityApp), {
  onRecoverableError(error) {
    recoverableErrors.push(String(error));
  },
});

const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

await waitFor(() => container.querySelector("button") !== null, "hydration");
const beforeInteraction = container.querySelector("[data-value]")?.textContent;
container
  .querySelector("button")
  .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(
  () => container.querySelector("[data-value]")?.textContent === "1",
  "hydrated interaction",
);
const afterInteraction = container.querySelector("[data-value]")?.textContent;
// Exercise the composed refs in the packed package under every supported
// runtime. A cleanup-returning consumer callback must work through the kit's
// adapter even on React 18, where the DOM ref itself must return void.
const attached = [];
const detached = [];
const nullCalls = [];
const controlRef = (name) => (node) => {
  if (node === null) {
    nullCalls.push(name);
    return;
  }
  attached.push(name);
  return () => detached.push(name);
};
const portalHost = dom.window.document.createElement("div");
dom.window.document.body.append(portalHost);
root.render(
  createElement(
    PretableOverlayProvider,
    { container: portalHost },
    createElement(PretableCheckbox, {
      "aria-label": "Compatibility checkbox",
      checked: false,
      onCheckedChange: () => {},
      ref: controlRef("checkbox"),
    }),
    createElement(PretableSelect, {
      "aria-label": "Compatibility select",
      value: "one",
      options: [{ value: "one", label: "One" }],
      onChange: () => {},
      ref: controlRef("select"),
    }),
    createElement(PretableTextarea, {
      "aria-label": "Compatibility notes",
      ref: controlRef("textarea"),
    }),
    createElement(PretableTextInput, {
      "aria-label": "Compatibility input",
      ref: controlRef("input"),
    }),
  ),
);
await waitFor(() => attached.length === 4, "control ref attachment");
container
  .querySelector("[data-pretable-select]")
  .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(
  () => portalHost.querySelector('[role="listbox"]') !== null,
  "scoped portal attachment",
);
root.unmount();
if (portalHost.childNodes.length !== 0)
  throw new Error("Scoped portal did not detach");
portalHost.remove();
if (detached.length !== 4 || nullCalls.length !== 0) {
  throw new Error(
    `Control ref cleanup failed: ${JSON.stringify({ attached, detached, nullCalls })}`,
  );
}
await new Promise((resolve) => setTimeout(resolve, 0));

process.off("unhandledRejection", onUnhandledRejection);
dom.window.removeEventListener("error", onError);
const evidence = {
  afterInteraction,
  beforeInteraction,
  containerEmptyAfterUnmount: container.childNodes.length === 0,
  recoverableErrors,
  serverMarkup,
  unexpectedErrors,
};

for (const [name, descriptor] of previousGlobals) {
  if (descriptor === undefined) delete globalThis[name];
  else Object.defineProperty(globalThis, name, descriptor);
}
dom.window.close();
console.log(JSON.stringify(evidence));
