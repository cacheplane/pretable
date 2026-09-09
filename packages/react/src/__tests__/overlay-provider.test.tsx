import { FunnelButton } from "../filter-menu/FunnelButton";
import { MenuButton } from "../column-menu/MenuButton";
import { useMenuKeyboard } from "../overlay/menu-keyboard";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import { PretableOverlayProvider as Provider } from "../public_api";
import { PretableSelect } from "../components/select";
import { OverlayPortal } from "../overlay/OverlayPortal";
import { FilterMenu } from "../filter-menu/FilterMenu";
import { ColumnMenu } from "../column-menu/ColumnMenu";

const hosts: HTMLElement[] = [];
const host = () => {
  const node = document.createElement("div");
  document.body.append(node);
  hosts.push(node);
  return node;
};
afterEach(() => {
  cleanup();
  for (const node of hosts.splice(0)) node.remove();
});
const select = (
  <PretableSelect
    aria-label="Pick"
    options={[{ value: "a", label: "Alpha" }]}
    value="a"
    onChange={() => {}}
  />
);

test("null waits, target attachment reveals open intent, removal clears ARIA and reattachment restores", () => {
  const target = host();
  const view = render(<Provider container={null}>{select}</Provider>);
  const trigger = view.getByRole("combobox");
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).not.toHaveAttribute("aria-controls");
  expect(trigger).not.toHaveAttribute("aria-activedescendant");
  expect(view.queryByRole("listbox")).toBeNull();
  view.rerender(<Provider container={target}>{select}</Provider>);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(target).toContainElement(view.getByRole("listbox"));
  expect(
    document.getElementById(trigger.getAttribute("aria-activedescendant")!),
  ).not.toBeNull();
  view.rerender(<Provider container={null}>{select}</Provider>);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).not.toHaveAttribute("aria-controls");
  expect(trigger).not.toHaveAttribute("aria-activedescendant");
  view.rerender(<Provider container={target}>{select}</Provider>);
  expect(target).toContainElement(view.getByRole("listbox"));
});

test("default body, custom targets, nearest provider and target replacement", () => {
  const outer = host();
  const inner = host();
  const replacement = host();
  const content = (
    <>
      <OverlayPortal>
        <div data-testid="outer" />
      </OverlayPortal>
      <Provider container={inner}>
        <OverlayPortal>
          <div data-testid="inner" />
        </OverlayPortal>
      </Provider>
    </>
  );
  const view = render(<Provider container={outer}>{content}</Provider>);
  expect(outer).toContainElement(view.getByTestId("outer"));
  expect(inner).toContainElement(view.getByTestId("inner"));
  expect(outer).not.toContainElement(view.getByTestId("inner"));
  view.rerender(<Provider container={replacement}>{content}</Provider>);
  expect(outer.querySelector('[data-testid="outer"]')).toBeNull();
  expect(replacement).toContainElement(view.getByTestId("outer"));
  view.rerender(
    <OverlayPortal>
      <div data-testid="default" />
    </OverlayPortal>,
  );
  expect(document.body).toContainElement(view.getByTestId("default"));
  expect(view.container).not.toContainElement(view.getByTestId("default"));
});

test.each(["filter", "column"])(
  "%s menu takes focus on attachment and reattachment, not ordinary rerenders",
  (kind) => {
    const target = host();
    const menu =
      kind === "filter" ? (
        <FilterMenu
          columnId="a"
          label="A"
          type="text"
          options={[]}
          initialFilter={null}
          onChange={() => {}}
          onClose={() => {}}
        />
      ) : (
        <ColumnMenu
          anchor={null}
          columnId="a"
          label="A"
          grouped={false}
          onSelect={() => {}}
          onClose={() => {}}
        />
      );
    const view = render(<Provider container={null}>{menu}</Provider>);
    expect(target.children).toHaveLength(0);
    view.rerender(<Provider container={target}>{menu}</Provider>);
    const focusTarget = view.getByRole(
      kind === "filter" ? "combobox" : "menuitem",
    );
    expect(focusTarget).toHaveFocus();
    const other = document.createElement("button");
    target.append(other);
    other.focus();
    view.rerender(<Provider container={target}>{menu}</Provider>);
    expect(other).toHaveFocus();
    view.rerender(<Provider container={null}>{menu}</Provider>);
    view.rerender(<Provider container={target}>{menu}</Provider>);
    expect(
      view.getByRole(kind === "filter" ? "combobox" : "menuitem"),
    ).toHaveFocus();
  },
);

test("server markup hydrates and focuses a menu when its portal attaches", async () => {
  const target = host();
  const source = host();
  const content = (
    <Provider container={target}>
      <ColumnMenu
        anchor={null}
        columnId="a"
        label="A"
        grouped={false}
        onSelect={() => {}}
        onClose={() => {}}
      />
    </Provider>
  );
  source.innerHTML = renderToString(content);
  expect(target.children).toHaveLength(0);
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(source, content);
  });
  expect(target.querySelector('[role="menuitem"]')).toHaveFocus();
  await act(async () => root.unmount());
});

function ToolMenu() {
  const { rootRef, onKeyDown } = useMenuKeyboard(() => {});
  return (
    <OverlayPortal>
      <div ref={rootRef} onKeyDown={onKeyDown}>
        <button data-pretable-menu-item="" disabled>
          Disabled
        </button>
        <button data-pretable-menu-item="">Enabled</button>
      </div>
    </OverlayPortal>
  );
}

test("shared tool menu keyboard focuses its first enabled item on delayed attachment", () => {
  const target = host();
  const view = render(
    <Provider container={null}>
      <ToolMenu />
    </Provider>,
  );
  view.rerender(
    <Provider container={target}>
      <ToolMenu />
    </Provider>,
  );
  expect(view.getByText("Enabled")).toHaveFocus();
  const other = document.createElement("button");
  target.append(other);
  other.focus();
  view.rerender(
    <Provider container={target}>
      <ToolMenu />
    </Provider>,
  );
  expect(other).toHaveFocus();
  view.rerender(
    <Provider container={null}>
      <ToolMenu />
    </Provider>,
  );
  view.rerender(
    <Provider container={target}>
      <ToolMenu />
    </Provider>,
  );
  expect(view.getByText("Enabled")).toHaveFocus();
});

test("header trigger expanded state waits for the overlay host", () => {
  const target = host();
  const triggers = (
    <>
      <FunnelButton
        columnId="a"
        label="A"
        active={false}
        open
        onToggle={() => {}}
      />
      <MenuButton columnId="a" label="A" open onToggle={() => {}} />
    </>
  );
  const view = render(<Provider container={null}>{triggers}</Provider>);
  for (const button of view.getAllByRole("button"))
    expect(button).toHaveAttribute("aria-expanded", "false");
  view.rerender(<Provider container={target}>{triggers}</Provider>);
  for (const button of view.getAllByRole("button"))
    expect(button).toHaveAttribute("aria-expanded", "true");
});
