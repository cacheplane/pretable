"use client";

import { PretableCheckbox } from "@pretable/react";
import { useState } from "react";

const projects = ["Atlas", "Beacon", "Cedar"];

export function CheckboxSelectionExample() {
  const [selected, setSelected] = useState<string[]>(["Atlas"]);
  const allChecked =
    selected.length === projects.length
      ? true
      : selected.length === 0
        ? false
        : "mixed";

  return (
    <div style={{ padding: 20, maxWidth: 360, fontSize: 13 }}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <PretableCheckbox
          checked={allChecked}
          onCheckedChange={(checked) =>
            setSelected(checked ? [...projects] : [])
          }
        />
        Select all projects
      </label>
      <div style={{ display: "grid", gap: 10 }}>
        {projects.map((project) => (
          <label
            key={project}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <PretableCheckbox
              checked={selected.includes(project)}
              onCheckedChange={(checked) =>
                setSelected((current) =>
                  checked
                    ? [...current, project]
                    : current.filter((name) => name !== project),
                )
              }
            />
            {project}
          </label>
        ))}
      </div>
      <p role="status" style={{ margin: "12px 0 0" }}>
        {selected.length} of {projects.length} selected
      </p>
    </div>
  );
}
