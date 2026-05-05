import { NavBar } from "../components/NavBar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <NavBar mode="site" />
      {children}
    </>
  );
}
