"use client";

import fuzzysort from "fuzzysort";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface SearchEntry {
  slug: string;
  title: string;
  description: string;
  nav: string;
  headings: string[];
  body: string;
}

function rankResults(query: string, idx: SearchEntry[]): SearchEntry[] {
  if (!query) return idx.slice(0, 8);
  const q = query.toLowerCase();
  const fuzzy = fuzzysort.go(query, idx, {
    keys: ["title", "headings", "description", "body"],
    scoreFn: (a) =>
      Math.max(
        (a[0]?.score ?? -1000) * 4,
        (a[1]?.score ?? -1000) * 2,
        a[2]?.score ?? -1000,
        (a[3]?.score ?? -1000) * 0.5,
      ),
  });
  const out = fuzzy.map((r) => r.obj);
  // Stable boost: pages whose title starts with the literal query string
  // jump to the front, in their existing relative order.
  out.sort((a, b) => {
    const aPrefix = a.title.toLowerCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.title.toLowerCase().startsWith(q) ? 0 : 1;
    return aPrefix - bPrefix;
  });
  return out.slice(0, 8);
}

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || index) return;
    fetch("/docs/search-index.json")
      .then((r) => r.json())
      .then(setIndex);
  }, [open, index]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const results = index ? rankResults(q, index) : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 backdrop-blur-sm"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => setOpen(false)}
      />
      <div className="relative mx-auto mt-[15vh] max-w-[640px] rounded-md border border-rule bg-bg-card shadow-lg">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded
          aria-controls="search-results"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the docs"
          className="w-full border-b border-rule bg-transparent px-4 py-3 font-mono text-[14px] outline-none"
        />
        <ul id="search-results" className="max-h-[60vh] overflow-y-auto py-2">
          {results.map((r) => (
            <li key={r.slug}>
              <Link
                href={r.slug}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 hover:bg-bg-raised"
              >
                <div className="font-display text-[14px] text-text-primary">
                  {r.title}
                </div>
                <div className="font-mono text-[11px] text-text-dim">
                  {r.nav}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
