import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnFilter } from "@pretable/core";

import { FilterMenu } from "../filter-menu";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

type Props = Parameters<typeof FilterMenu>[0];

function renderMenu(over: Partial<Props> = {}) {
  const onChange = vi.fn<(id: string, f: ColumnFilter | null) => void>();
  const onClose = vi.fn();
  const props: Props = {
    columnId: "c",
    label: "Name",
    filterType: "text",
    options: [],
    initialFilter: null,
    onChange,
    onClose,
    ...over,
  };
  act(() => {
    render(<FilterMenu {...props} />);
  });
  return { onChange, onClose };
}

const lastCall = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls[fn.mock.calls.length - 1];

describe("FilterMenu — dialog basics", () => {
  it("renders a dialog with an accessible name and focuses the operator select", () => {
    renderMenu();
    const dialog = screen.getByRole("dialog", { name: "Filter Name" });
    expect(dialog).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Filter operator" });
    expect(select).toHaveFocus();
  });

  it("defaults a text column to the `contains` operator", () => {
    renderMenu({ filterType: "text" });
    const select = screen.getByRole("combobox", {
      name: "Filter operator",
    }) as HTMLSelectElement;
    expect(select.value).toBe("contains");
  });
});

describe("FilterMenu — text live-apply (debounced)", () => {
  it("debounces typing then fires onChange with the contains filter", async () => {
    const { onChange } = renderMenu({ filterType: "text" });
    const input = screen.getByRole("textbox", { name: "Filter value" });

    act(() => {
      fireEvent.change(input, { target: { value: "ad" } });
    });
    // Not applied immediately.
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(lastCall(onChange)).toEqual([
      "c",
      { operator: "contains", value: "ad" },
    ]);
  });
});

describe("FilterMenu — operator switch", () => {
  it("switching to isEmpty hides the value input and applies immediately", () => {
    const { onChange } = renderMenu({ filterType: "text" });
    const select = screen.getByRole("combobox", { name: "Filter operator" });

    act(() => {
      fireEvent.change(select, { target: { value: "isEmpty" } });
    });

    expect(screen.queryByRole("textbox", { name: "Filter value" })).toBeNull();
    expect(lastCall(onChange)).toEqual(["c", { operator: "isEmpty" }]);
  });
});

describe("FilterMenu — number between gating", () => {
  it("clears when only min is set, applies when both bounds present", async () => {
    const { onChange } = renderMenu({ filterType: "number" });
    const select = screen.getByRole("combobox", { name: "Filter operator" });

    act(() => {
      fireEvent.change(select, { target: { value: "between" } });
    });
    // operator change with empty range → null
    expect(lastCall(onChange)).toEqual(["c", null]);

    const min = screen.getByRole("textbox", { name: "Filter minimum" });
    act(() => {
      fireEvent.change(min, { target: { value: "1" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    // only min → still null
    expect(lastCall(onChange)).toEqual(["c", null]);

    const max = screen.getByRole("textbox", { name: "Filter maximum" });
    act(() => {
      fireEvent.change(max, { target: { value: "10" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(lastCall(onChange)).toEqual([
      "c",
      { operator: "between", value: [1, 10] },
    ]);
  });
});

describe("FilterMenu — enum set", () => {
  it("renders options as checkboxes; checking applies, unchecking all clears", () => {
    const { onChange } = renderMenu({
      filterType: "enum",
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    });

    const alpha = screen.getByRole("checkbox", { name: "Alpha" });
    const beta = screen.getByRole("checkbox", { name: "Beta" });

    act(() => {
      fireEvent.click(alpha);
    });
    expect(lastCall(onChange)).toEqual([
      "c",
      { operator: "isAnyOf", value: ["a"] },
    ]);

    act(() => {
      fireEvent.click(beta);
    });
    expect(lastCall(onChange)).toEqual([
      "c",
      { operator: "isAnyOf", value: ["a", "b"] },
    ]);

    act(() => {
      fireEvent.click(alpha);
    });
    act(() => {
      fireEvent.click(beta);
    });
    // all unchecked → null
    expect(lastCall(onChange)).toEqual(["c", null]);
  });
});

describe("FilterMenu — clear", () => {
  it("Clear button fires onChange(id, null)", () => {
    const { onChange } = renderMenu({
      filterType: "text",
      initialFilter: { operator: "contains", value: "ada" },
    });
    const clear = screen.getByRole("button", { name: "Clear" });
    act(() => {
      fireEvent.click(clear);
    });
    expect(lastCall(onChange)).toEqual(["c", null]);
  });
});

describe("FilterMenu — hydrate from initialFilter", () => {
  it("seeds the operator and value from an existing filter", () => {
    renderMenu({
      filterType: "text",
      initialFilter: { operator: "startsWith", value: "Ad" },
    });
    const select = screen.getByRole("combobox", {
      name: "Filter operator",
    }) as HTMLSelectElement;
    expect(select.value).toBe("startsWith");
    expect(screen.getByRole("textbox", { name: "Filter value" })).toHaveValue(
      "Ad",
    );
  });
});

describe("FilterMenu — date single applies immediately", () => {
  it("date input applies without waiting for the debounce", () => {
    const { onChange } = renderMenu({ filterType: "date" });
    const select = screen.getByRole("combobox", { name: "Filter operator" });
    act(() => {
      fireEvent.change(select, { target: { value: "before" } });
    });
    const input = screen.getByLabelText("Filter value");
    act(() => {
      fireEvent.change(input, { target: { value: "2026-06-18" } });
    });
    expect(lastCall(onChange)).toEqual([
      "c",
      { operator: "before", value: "2026-06-18" },
    ]);
  });
});

describe("FilterMenu — outside click", () => {
  it("calls onClose when a pointerdown lands outside the dialog", () => {
    const { onClose } = renderMenu();
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on a pointerdown inside the dialog", () => {
    const { onClose } = renderMenu();
    const dialog = screen.getByRole("dialog");
    act(() => {
      fireEvent.pointerDown(dialog);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("FilterMenu — flush on unmount", () => {
  it("applies a pending debounced edit when unmounted before the timer fires", () => {
    const onChange = vi.fn<(id: string, f: ColumnFilter | null) => void>();
    let unmount: () => void;
    act(() => {
      const r = render(
        <FilterMenu
          columnId="c"
          label="Name"
          filterType="text"
          options={[]}
          initialFilter={null}
          onChange={onChange}
          onClose={vi.fn()}
        />,
      );
      unmount = r.unmount;
    });
    const input = screen.getByRole("textbox", { name: "Filter value" });
    act(() => {
      fireEvent.change(input, { target: { value: "x" } });
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      unmount();
    });
    expect(lastCall(onChange)).toEqual([
      "c",
      { operator: "contains", value: "x" },
    ]);
  });
});
