export interface Ticket {
  id: string;
  key: string;
  status: string;
  summary: string;
  owner: string;
}

export const tickets: Ticket[] = [
  {
    id: "t1",
    key: "GRID-101",
    status: "Open",
    summary: "Header row leaves a blank band on the right at wide viewports",
    owner: "Priya N.",
  },
  {
    id: "t2",
    key: "GRID-102",
    status: "In review",
    summary: "Flex share rounds a pixel short",
    owner: "Marcus C.",
  },
  {
    id: "t3",
    key: "GRID-103",
    status: "Open",
    summary:
      "Resize handle on a flex column should hand the column a manual width instead of being ignored",
    owner: "Ana F.",
  },
  {
    id: "t4",
    key: "GRID-104",
    status: "Done",
    summary: "Document minWidthPx as a floor on the flex share",
    owner: "Tom O.",
  },
  {
    id: "t5",
    key: "GRID-105",
    status: "Blocked",
    summary:
      "Narrow viewport: fixed columns exceed the width, grid must scroll",
    owner: "Priya N.",
  },
  {
    id: "t6",
    key: "GRID-106",
    status: "Open",
    summary: "Owner column collapses to a sliver",
    owner: "Sofia L.",
  },
  {
    id: "t7",
    key: "GRID-107",
    status: "In review",
    summary:
      "Hero grid on the homepage should absorb the leftover width in its last column",
    owner: "Marcus C.",
  },
  {
    id: "t8",
    key: "GRID-108",
    status: "Done",
    summary: "Add a live example for flex",
    owner: "Tom O.",
  },
  {
    id: "t9",
    key: "GRID-109",
    status: "Open",
    summary: "Scrolled-seam fixture amount column should fill",
    owner: "Ana F.",
  },
  {
    id: "t10",
    key: "GRID-110",
    status: "Blocked",
    summary:
      "Two flex columns with unequal weights should split the leftover in proportion, not evenly",
    owner: "Sofia L.",
  },
  {
    id: "t11",
    key: "GRID-111",
    status: "Open",
    summary: "Floor of 24px when no minWidthPx is declared",
    owner: "Priya N.",
  },
  {
    id: "t12",
    key: "GRID-112",
    status: "Done",
    summary: "Prove the row ends on the viewport edge at 1280 and 900",
    owner: "Marcus C.",
  },
];
