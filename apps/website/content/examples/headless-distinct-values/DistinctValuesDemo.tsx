"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createLocalRowModel,
  type PretableDistinctValueQuery,
} from "@pretable/core";
import { useDisposeOnUnmount } from "@pretable/react";

import { columns } from "./columns";
import { contacts } from "./data";

interface TeamOption {
  readonly value: string;
  readonly count: number;
}

export function DistinctValuesDemo() {
  const [rowModel] = useState(() =>
    createLocalRowModel({ columns, rows: contacts }),
  );
  useDisposeOnUnmount(rowModel);

  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<readonly TeamOption[]>([]);
  const [totalDistinct, setTotalDistinct] = useState(0);
  // Starts true: the mount effect below fires the first request without
  // itself calling setState synchronously, so "pending" has to already be
  // true rather than being set by that effect.
  const [pending, setPending] = useState(true);

  // Cancelling the in-flight request when a new one starts — rather than
  // letting a slow earlier keystroke resolve after a faster later one — is
  // what "asynchronous and cancellable" buys you here.
  const activeRequest = useRef<PretableDistinctValueQuery<string> | null>(null);

  const startSearch = useCallback(
    (value: string) => {
      activeRequest.current?.cancel();
      const request = rowModel.distinctValues("team", {
        search: value,
        limit: 8,
      });
      activeRequest.current = request;
      request.finished
        .then((result) => {
          if (activeRequest.current !== request) return; // superseded
          setOptions(
            result.values.map((v) => ({ value: v.value, count: v.count })),
          );
          setTotalDistinct(result.totalDistinct);
          setPending(false);
        })
        .catch(() => {
          // A cancelled request rejects `finished`. That's expected every
          // time a keystroke supersedes the previous request, so there is
          // nothing to surface here.
        });
    },
    [rowModel],
  );

  useEffect(() => {
    startSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once; later searches come from onChange
  }, []);

  return (
    <div>
      <label style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
        Search teams{" "}
        <input
          aria-label="Search teams"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPending(true);
            startSearch(e.target.value);
          }}
        />
      </label>
      <p role="status" style={{ fontSize: 13 }}>
        {pending
          ? "Searching…"
          : `${totalDistinct} matching team${totalDistinct === 1 ? "" : "s"}`}
      </p>
      <ul>
        {options.map((opt) => (
          <li key={opt.value}>
            {opt.value} ({opt.count})
          </li>
        ))}
      </ul>
    </div>
  );
}
