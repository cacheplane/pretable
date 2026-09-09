import { usePretableComponents } from "../components/context";
import { createElement, useId, useMemo, useState } from "react";
import type { ColumnOption, PretableFocusDirection } from "@pretable/core";
import {
  Listbox,
  listboxOptionId,
  useListboxKeys,
} from "../components/listbox";
import { useOverlayContainer } from "../overlay/portal-context";
import type { PretableEditorInput } from "../types";
import { filterOptions, matchOption, optionLabel } from "./enum-options";
import { enumChoice, enumDraftText, isEnumChoice } from "./enum-draft";
import { editorCommitDirection } from "./editor-keyboard";
import { useEditorField } from "./use-editor-field";
import { useEditorAnchor } from "./use-editor-anchor";

const NOOP = () => {};

/** Editable query and intentional choice use separate channels; labels never encode identity. */
export function EnumCellEditor({ input }: { input: PretableEditorInput }) {
  const { TextInput } = usePretableComponents();
  const { ref, attachRef, pending, fieldProps, isComposing } =
    useEditorField<HTMLInputElement>(input);
  const options = useMemo(
    () => input.column.options ?? [],
    [input.column.options],
  );
  const listId = useId();
  const overlayReady = useOverlayContainer() !== null;
  const { anchorRef, rect } = useEditorAnchor(overlayReady);
  const [dirty, setDirty] = useState(
    () =>
      input.seededFromTyping ??
      (!Object.is(input.draft, input.value) &&
        !matchOption(options, enumDraftText(input.draft))),
  );
  const [navigated, setNavigated] = useState(false);
  const chosenValue = isEnumChoice(input.draft)
    ? input.draft.value
    : !dirty &&
        input.value !== null &&
        input.value !== undefined &&
        input.value !== ""
      ? String(input.value)
      : null;
  const chosen = options.find((option) => option.value === chosenValue);
  const text = chosen ? optionLabel(chosen) : enumDraftText(input.draft);
  const visible = useMemo(
    () => (dirty ? filterOptions(options, text) : options),
    [options, dirty, text],
  );
  const listOptions = useMemo(
    () =>
      visible.map((option) => ({
        value: option.value,
        label: optionLabel(option),
      })),
    [visible],
  );
  const seed = Math.max(
    0,
    visible.findIndex((option) => option.value === chosenValue),
  );
  const choose = (
    option: ColumnOption | undefined,
    direction?: PretableFocusDirection,
  ) => {
    if (!option || pending) return;
    setDirty(false);
    setNavigated(false);
    keys.setActiveIndex(
      options.findIndex((entry) => entry.value === option.value),
    );
    input.setDraft(enumChoice(option.value));
    if (direction) input.commit(direction);
    else input.commit();
  };
  const keys = useListboxKeys({
    options: listOptions,
    open: true,
    initialIndex: seed,
    onOpen: NOOP,
    onCommit: NOOP,
    onClose: NOOP,
  });
  const active = visible[keys.activeIndex];
  const commitCurrent = (direction?: PretableFocusDirection) => {
    if (pending) return;
    if (chosenValue !== null) input.setDraft(enumChoice(chosenValue));
    if (direction) input.commit(direction);
    else input.commit();
  };
  return (
    <span ref={anchorRef} data-pretable-enum-editor="">
      <TextInput
        site="cell-editor"
        ref={attachRef}
        className="pretable-cell-editor"
        role="combobox"
        aria-expanded={overlayReady && visible.length > 0}
        aria-controls={overlayReady && visible.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          overlayReady && active
            ? listboxOptionId(listId, keys.activeIndex)
            : undefined
        }
        value={text}
        onChange={(event) => {
          if (pending) return;
          setDirty(true);
          setNavigated(false);
          keys.setActiveIndex(0);
          input.setDraft(event.target.value);
        }}
        {...fieldProps}
        onBlur={() => {
          if (input.status === "editing") {
            if (navigated && active) choose(active);
            else commitCurrent();
          }
        }}
        onKeyDown={(event) => {
          if (isComposing(event)) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (pending) {
              event.preventDefault();
              event.stopPropagation();
            } else {
              setNavigated(true);
              keys.onKeyDown(event);
            }
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            if (navigated && active)
              choose(active, editorCommitDirection(event));
            else commitCurrent(editorCommitDirection(event));
            return;
          }
          fieldProps.onKeyDown(event);
        }}
      />
      <Listbox
        id={listId}
        width="dialog"
        options={listOptions}
        value={chosen?.value ?? null}
        activeIndex={keys.activeIndex}
        anchor={rect}
        onSelect={(value) =>
          choose(visible.find((option) => option.value === value))
        }
        onClose={NOOP}
        trigger={ref}
      />
    </span>
  );
}
