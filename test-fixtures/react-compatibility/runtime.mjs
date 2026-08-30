import { JSDOM } from "jsdom";
import { createElement, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { PretableBadge } from "@pretable/react";

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
root.unmount();
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
