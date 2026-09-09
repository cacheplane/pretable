import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { PretableTextarea } from "../components/textarea";
import { resetDevWarnings } from "../dev-warn";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetDevWarnings();
});
test("native multiline attributes, events, and element ref pass through", () => {
  const ref = createRef<HTMLTextAreaElement>();
  const change = vi.fn();
  const view = render(
    <PretableTextarea
      ref={ref}
      aria-label="Notes"
      rows={3}
      maxLength={120}
      name="notes"
      site="cell-editor"
      data-pretable-site="wrong"
      data-pretable-textarea="wrong"
      value="A\nB"
      onChange={change}
    />,
  );
  const field = view.getByRole("textbox");
  expect(field.tagName).toBe("TEXTAREA");
  expect(ref.current).toBe(field);
  expect(field).toHaveAttribute("rows", "3");
  expect(field).toHaveAttribute("maxlength", "120");
  expect(field).toHaveAttribute("name", "notes");
  expect(field).toHaveAttribute("data-pretable-site", "cell-editor");
  expect(field).toHaveAttribute("data-pretable-textarea", "");
  fireEvent.change(field, { target: { value: "new" } });
  expect(change).toHaveBeenCalledOnce();
  view.rerender(
    <PretableTextarea ref={ref} aria-label="Notes" disabled readOnly />,
  );
  expect(field).toBeDisabled();
  expect(field).toHaveAttribute("readonly");
  expect(field).not.toHaveAttribute("data-pretable-site");
  view.unmount();
  expect(ref.current).toBeNull();
});
test("warns once for unnamed fields and accepts a native label", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const view = render(
    <label>
      Notes
      <PretableTextarea />
    </label>,
  );
  expect(warn).not.toHaveBeenCalled();
  view.unmount();
  render(
    <>
      <PretableTextarea />
      <PretableTextarea />
    </>,
  );
  expect(warn).toHaveBeenCalledOnce();
});
