"use client";

import { useId, useState } from "react";
import { PretableButton, PretableTextarea } from "@pretable/react";

export function EditNote() {
  const fieldId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");

  return (
    <div style={{ maxWidth: 420 }}>
      <label htmlFor={fieldId} style={{ display: "block", marginBottom: 8 }}>
        Handoff note
      </label>
      <PretableTextarea
        id={fieldId}
        rows={3}
        maxLength={160}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-describedby={hintId}
        placeholder="What should the next teammate know?"
        style={{ width: "100%", resize: "vertical" }}
      />
      <p id={hintId} style={{ margin: "8px 0", fontSize: 13 }}>
        Up to 160 characters. Enter adds a new line.
      </p>
      <PretableButton
        disabled={!draft.trim() || draft === saved}
        onClick={() => setSaved(draft)}
      >
        Save note
      </PretableButton>
      <p role="status" style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>
        {saved ? `Saved note:\n${saved}` : "No note saved yet."}
      </p>
    </div>
  );
}
