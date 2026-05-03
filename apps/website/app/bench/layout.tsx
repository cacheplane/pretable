import { NavBar } from "../components/NavBar";

export default function BenchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <NavBar mode="site" />
      <main className="mx-auto max-w-[920px] px-7 py-12 md:px-10 md:py-16">
        {children}
      </main>
    </>
  );
}
