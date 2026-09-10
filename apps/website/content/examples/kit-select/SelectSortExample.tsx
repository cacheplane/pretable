"use client";

import { PretableSelect, type PretableSelectOption } from "@pretable/react";
import { useId, useState } from "react";

const projects = [
  { name: "Atlas", updated: 1 },
  { name: "Beacon", updated: 3 },
  { name: "Cedar", updated: 2 },
];

const options: readonly PretableSelectOption[] = [
  { value: "ascending", label: "Name: A–Z" },
  { value: "manual", label: "Manual order (unavailable)", disabled: true },
  { value: "descending", label: "Name: Z–A" },
  {
    value: "recent",
    label: (
      <span>
        Recently updated <small>(newest first)</small>
      </span>
    ),
    // Rich labels need plain text for keyboard typeahead.
    textValue: "Recently updated",
  },
];

export function SelectSortExample() {
  const selectId = useId();
  const [sort, setSort] = useState("ascending");
  const sortedProjects = [...projects].sort((a, b) =>
    sort === "recent"
      ? b.updated - a.updated
      : sort === "descending"
        ? b.name.localeCompare(a.name)
        : a.name.localeCompare(b.name),
  );

  return (
    <div style={{ padding: 20, maxWidth: 360, fontSize: 13 }}>
      <label htmlFor={selectId} style={{ display: "block", marginBottom: 8 }}>
        Sort projects
      </label>
      <PretableSelect
        id={selectId}
        aria-label="Sort projects"
        options={options}
        value={sort}
        onChange={setSort}
      />
      <ol
        aria-label="Projects"
        style={{ margin: "16px 0 0", paddingLeft: 24, display: "grid", gap: 6 }}
      >
        {sortedProjects.map((project) => (
          <li key={project.name}>{project.name}</li>
        ))}
      </ol>
    </div>
  );
}
