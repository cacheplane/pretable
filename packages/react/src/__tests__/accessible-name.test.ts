import { afterEach, expect, test } from "vitest";
import { hasAccessibleName } from "../components/accessible-name";

afterEach(() => {
  document.body.replaceChildren();
});

test.each([
  "<label><input /></label>",
  '<span id="name"></span><input aria-labelledby="name" />',
  '<input aria-labelledby="missing" />',
  '<label for="field"> </label><input id="field" />',
])("does not accept an empty or unresolved name: %s", (html) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  expect(hasAccessibleName(host.querySelector("input")!)).toBe(false);
  host.remove();
});
test.each([
  '<input title="Value" />',
  '<span id="name">Value</span><input aria-labelledby="missing name" />',
  "<label>Value<input /></label>",
])("accepts a meaningful bounded name source: %s", (html) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  expect(hasAccessibleName(host.querySelector("input")!)).toBe(true);
  host.remove();
});
