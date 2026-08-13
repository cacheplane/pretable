export interface Person {
  id: string;
  name: string;
  role: string;
  city: string;
}

export const people: Person[] = [
  { id: "1", name: "Ada", role: "Engineer", city: "London" },
  { id: "2", name: "Grace", role: "Admiral", city: "New York" },
  { id: "3", name: "Linus", role: "Maintainer", city: "Helsinki" },
  { id: "4", name: "Margaret", role: "Director", city: "Boston" },
  { id: "5", name: "Tim", role: "Inventor", city: "London" },
];
