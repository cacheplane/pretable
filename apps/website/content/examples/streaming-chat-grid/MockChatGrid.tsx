"use client";

import { useEffect, useState } from "react";

interface Row {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
  latencyMs: number;
}

const SCRIPT: readonly Omit<Row, "id">[] = [
  {
    role: "user",
    content: "Summarize the last 10 incidents.",
    tokens: 9,
    latencyMs: 0,
  },
  {
    role: "assistant",
    content: "10 incidents over 30 days; 6 latency, 4 errors.",
    tokens: 15,
    latencyMs: 412,
  },
  {
    role: "assistant",
    content: "Top driver: cold-start regressions on the bench worker.",
    tokens: 11,
    latencyMs: 287,
  },
  {
    role: "assistant",
    content: "Recommend pinning the bench-worker pool size.",
    tokens: 8,
    latencyMs: 201,
  },
];

export interface MockChatGridProps {
  intervalMs?: number;
  maxRows?: number;
}

export function MockChatGrid({
  intervalMs = 700,
  maxRows = SCRIPT.length,
}: MockChatGridProps) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      if (i >= Math.min(maxRows, SCRIPT.length)) {
        clearInterval(id);
        return;
      }
      const next = SCRIPT[i];
      setRows((r) => [...r, { ...next, id: `r-${i}` }]);
      i += 1;
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, maxRows]);

  return (
    <table className="w-full border-collapse font-mono text-[12px]">
      <thead className="border-b border-rule bg-bg-card/50">
        <tr>
          <th className="px-3 py-2 text-left text-text-secondary">Role</th>
          <th className="px-3 py-2 text-left text-text-secondary">Content</th>
          <th className="px-3 py-2 text-right text-text-secondary">Tokens</th>
          <th className="px-3 py-2 text-right text-text-secondary">Latency</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-rule-soft">
            <td className="px-3 py-1.5 text-text-primary">{r.role}</td>
            <td className="px-3 py-1.5 text-text-primary">{r.content}</td>
            <td className="px-3 py-1.5 text-right text-text-dim">
              {r.tokens}
            </td>
            <td className="px-3 py-1.5 text-right text-text-dim">
              {r.latencyMs}ms
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
