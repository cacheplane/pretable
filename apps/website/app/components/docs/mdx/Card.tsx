import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";

export function CardGroup({
  cols = 2,
  children,
}: {
  cols?: 1 | 2 | 3;
  children: ReactNode;
}) {
  const grid = { 1: "grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" }[
    cols
  ];
  return (
    <div className={`my-6 grid grid-cols-1 gap-3 ${grid}`}>{children}</div>
  );
}

/**
 * `<Card>` is used block-style in MDX — its body on its own line(s), e.g.
 *
 *   <Card title="…" href="…">
 *     Some description.
 *   </Card>
 *
 * Written that way, remark parses the body as flow content and wraps it in
 * its own paragraph node, so `children` here arrives as a single `<p>`
 * element rather than raw text. Rendering that straight into this
 * component's own `<p>` below would nest a `<p>` inside a `<p>` — invalid
 * HTML that the browser's parser silently repairs by closing the outer tag
 * early, producing a DOM that no longer matches what React rendered on the
 * server (a hydration mismatch). Unwrap that single paragraph so only one
 * `<p>` ever reaches the DOM, regardless of how MDX chose to parse the body.
 */
function unwrapSoleParagraph(children: ReactNode): ReactNode {
  const kids = Children.toArray(children);
  if (kids.length === 1 && isValidElement(kids[0]) && kids[0].type === "p") {
    return (kids[0] as React.ReactElement<{ children?: ReactNode }>).props
      .children;
  }
  return children;
}

export function Card({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-[4px] border border-rule bg-bg-card/50 p-4 hover:border-rule"
    >
      <h4 className="font-display text-[15px] text-text-primary">{title}</h4>
      <p className="mt-1 text-[13px] text-text-secondary">
        {unwrapSoleParagraph(children)}
      </p>
    </Link>
  );
}
