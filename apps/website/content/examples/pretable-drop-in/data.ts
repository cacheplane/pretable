export interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
}

export const books: Book[] = [
  {
    id: "b1",
    title: "The Left Hand of Darkness",
    author: "Le Guin",
    year: 1969,
  },
  { id: "b2", title: "Kindred", author: "Butler", year: 1979 },
  { id: "b3", title: "Annihilation", author: "VanderMeer", year: 2014 },
  { id: "b4", title: "Piranesi", author: "Clarke", year: 2020 },
  { id: "b5", title: "Dune", author: "Herbert", year: 1965 },
];
