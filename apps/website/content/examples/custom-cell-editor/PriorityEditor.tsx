import { useId, useRef } from "react";
import type { PretableEditorInput } from "@pretable/react";

import type { Task } from "./data";

// Keep the component at module scope so changing the draft preserves focus.
export function PriorityEditor({
  draft,
  setDraft,
  status,
  error,
  commit,
  cancel,
}: PretableEditorInput<Task>) {
  const errorId = useId();
  const composing = useRef(false);
  const skipBlur = useRef(false);
  const pending =
    status === "checking" || status === "validating" || status === "saving";

  return (
    <div
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8 }}
    >
      <select
        autoFocus
        aria-label="Priority"
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errorId : undefined}
        aria-describedby={error ? errorId : undefined}
        value={String(draft ?? "")}
        style={{ width: 84, flexShrink: 0 }}
        // A select has no readOnly. Keep it focusable while guarding changes.
        onPointerDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onChange={(event) => {
          if (!pending) {
            skipBlur.current = false;
            setDraft(event.target.value);
          }
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          if (pending) {
            event.preventDefault();
          } else if (event.key === "Escape") {
            event.preventDefault();
            skipBlur.current = true;
            cancel();
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            skipBlur.current = true;
            commit(
              event.key === "Tab"
                ? event.shiftKey
                  ? "left"
                  : "right"
                : event.shiftKey
                  ? "up"
                  : "down",
            );
          }
          // Arrow keys remain native option navigation; they never commit.
        }}
        onBlur={() => {
          if (!skipBlur.current && status === "editing") commit();
          skipBlur.current = false;
        }}
      >
        <option value="1">Low</option>
        <option value="2">Medium</option>
        <option value="3">High</option>
      </select>
      {pending && (
        <small role="status">
          {status === "checking"
            ? "Checking…"
            : status === "validating"
              ? "Validating…"
              : "Saving…"}
        </small>
      )}
      {/* renderEditor replaces the built-in error UI, so render it here. */}
      {error && (
        <small
          id={errorId}
          role="alert"
          style={{
            whiteSpace: "nowrap",
            color: "var(--pretable-text-error, #b42318)",
          }}
        >
          {error}
        </small>
      )}
    </div>
  );
}
