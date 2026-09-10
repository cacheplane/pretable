"use client";

import { useId, useState } from "react";
import { PretableTextInput } from "@pretable/react";

const people = ["Ada Lovelace", "Grace Hopper", "Katherine Johnson"];

export function SearchPeople() {
  const fieldId = useId();
  const resultsId = useId();
  const [query, setQuery] = useState("");
  const matches = people.filter((name) =>
    name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 360 }}>
      <label htmlFor={fieldId} style={{ display: "block", marginBottom: 8 }}>
        Find a teammate
      </label>
      <PretableTextInput
        id={fieldId}
        type="search"
        placeholder="Try Grace"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-controls={resultsId}
        style={{ width: "100%" }}
      />
      <p role="status" style={{ margin: "8px 0", fontSize: 13 }}>
        {matches.length} {matches.length === 1 ? "person" : "people"} found
      </p>
      <ul id={resultsId} aria-label="Matching teammates" style={{ margin: 0 }}>
        {matches.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
