# @pretable/app-streaming-demo

Replay-style demo app showing the Pretable streaming adapter feeding a captured OpenAI Responses stream into a grid with a realtime pipeline inspector. Plays a ~30 s LLM table fill followed by ~90 s of continuous price updates, with play / pause / scrub controls.

## Development

```
pnpm dev     # Vite dev server
pnpm build   # production build
pnpm test    # unit tests
```

The app ships with checked-in recordings at `src/recordings/phase1.jsonl` (real OpenAI capture) and `src/recordings/phase2.jsonl` (seeded random walk). The app is fully self-contained at runtime — no network calls.

## Regenerating recordings

### Phase 2 (deterministic, no network)

```
pnpm generate-phase2
```

Reads `phase1.jsonl`, seeds a PRNG with `0xC0FFEE`, writes 90 s of update batches to `phase2.jsonl`. Byte-identical across runs.

### Phase 1 (one-time, needs OpenAI API key)

```
export OPENAI_API_KEY=sk-...
pnpm capture
pnpm generate-phase2   # re-derive phase 2 from the new phase 1
```

Use `OPENAI_MODEL=...` to override the default model (`gpt-5`). The script writes every SSE event to `phase1.jsonl` with relative timestamps. Capture is non-deterministic — don't re-run unless you're intentionally refreshing the demo content.

### Dev fixture (tiny synthetic data, no network)

```
pnpm make-dev-fixture
```

Overwrites both recordings with a small synthetic dataset. Useful when resetting to a minimal known-good state during development.
