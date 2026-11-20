import test from "node:test";
import assert from "node:assert/strict";
import {
  publicationTurn,
  recordPublicationCallback,
  preparationSamples,
  publicationGate,
} from "../publication-probe-accounting.mjs";
test("preparation after a small commit remains subject to the maximum slice gate", () => {
  const turn = publicationTurn("Timeout");
  recordPublicationCallback(turn, 1, 1);
  recordPublicationCallback(turn, 9);
  assert.equal(turn.processingMs, 10);
  assert.equal(turn.commitMs, 1);
  assert.equal(turn.preparationMs, 9);
  assert.deepEqual(preparationSamples([turn]), [9]);
  assert.equal(publicationGate([1], preparationSamples([turn])).pass, false);
});
test("a slow isolated commit is governed by commit p95, not a maximum callback rule", () => {
  const turns = Array.from({ length: 100 }, (_, i) => {
    const turn = publicationTurn("Timeout");
    recordPublicationCallback(turn, i === 0 ? 12 : 1, i === 0 ? 12 : 1);
    return turn;
  });
  const gate = publicationGate(
    turns.map((turn) => turn.commitMs),
    preparationSamples(turns),
    turns.map((turn) => turn.processingMs),
  );
  assert.equal(gate.row_model_commit_p95_ms, 1);
  assert.equal(gate.rebuild_slice_max_ms, 0);
  assert.equal(gate.pass, true);
});
test("preparation before and after multiple commits accumulates until a real task boundary", () => {
  const turn = publicationTurn("Timeout");
  recordPublicationCallback(turn, 3);
  recordPublicationCallback(turn, 2, 1);
  recordPublicationCallback(turn, 1, 1);
  recordPublicationCallback(turn, 5);
  assert.deepEqual(preparationSamples([turn]), [9]);
  assert.equal(turn.processingMs, 11);
  assert.equal(turn.commits, 2);
});
test("only the measured commit portion of its callback is excluded", () => {
  const turn = publicationTurn("Timeout");
  recordPublicationCallback(turn, 7, 2);
  assert.deepEqual(preparationSamples([turn]), [5]);
  assert.throws(() => recordPublicationCallback(turn, 1, 2), RangeError);
});

test("complete commit-turn p95 remains a conservative gate alongside phase bounds", () => {
  const turn = publicationTurn("Timeout");
  recordPublicationCallback(turn, 6, 6);
  recordPublicationCallback(turn, 6);
  const gate = publicationGate([6], preparationSamples([turn]), [
    turn.processingMs,
  ]);
  assert.equal(gate.row_model_commit_p95_ms, 12);
  assert.equal(gate.rebuild_slice_max_ms, 6);
  assert.equal(gate.pass, false);
});
