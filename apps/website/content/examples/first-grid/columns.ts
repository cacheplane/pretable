import type { PretableColumn } from "@pretable/react";

import type { Person } from "./data";

export const columns: PretableColumn<Person>[] = [
  { id: "name", header: "Name", value: (r) => r.name },
  { id: "role", header: "Role", value: (r) => r.role },
  { id: "city", header: "City", value: (r) => r.city },
];
