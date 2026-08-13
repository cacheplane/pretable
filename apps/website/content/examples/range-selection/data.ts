export interface Row {
  id: string;
  name: string;
  city: string;
  region: string;
  status: "ok" | "warn" | "error";
}

/**
 * A dozen rows across four columns — enough that a marquee drag spans a
 * genuine rectangle of cells and a shift-click range covers more than one
 * row, while still fitting the demo's fixed viewport without scrolling.
 */
export const rows: Row[] = [
  {
    id: "r1",
    name: "Ada Lovelace",
    city: "London",
    region: "EMEA",
    status: "ok",
  },
  {
    id: "r2",
    name: "Grace Hopper",
    city: "New York",
    region: "AMER",
    status: "ok",
  },
  {
    id: "r3",
    name: "Linus Torvalds",
    city: "Helsinki",
    region: "EMEA",
    status: "warn",
  },
  {
    id: "r4",
    name: "Margaret Hamilton",
    city: "Indianapolis",
    region: "AMER",
    status: "ok",
  },
  {
    id: "r5",
    name: "Alan Turing",
    city: "London",
    region: "EMEA",
    status: "error",
  },
  {
    id: "r6",
    name: "Katherine Johnson",
    city: "Hampton",
    region: "AMER",
    status: "ok",
  },
  {
    id: "r7",
    name: "Tim Berners-Lee",
    city: "London",
    region: "EMEA",
    status: "warn",
  },
  {
    id: "r8",
    name: "Radia Perlman",
    city: "Boston",
    region: "AMER",
    status: "ok",
  },
  {
    id: "r9",
    name: "Yukihiro Matsumoto",
    city: "Osaka",
    region: "APAC",
    status: "ok",
  },
  {
    id: "r10",
    name: "Hedy Lamarr",
    city: "Vienna",
    region: "EMEA",
    status: "ok",
  },
  {
    id: "r11",
    name: "Shigeru Miyamoto",
    city: "Kyoto",
    region: "APAC",
    status: "warn",
  },
  {
    id: "r12",
    name: "Barbara Liskov",
    city: "Boston",
    region: "AMER",
    status: "ok",
  },
];
