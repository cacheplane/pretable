import { describe, expect, it } from "vitest";
import { createSlotAllocator } from "../slot-allocator";

describe("slot allocator", () => {
  it("allocates dense sequential slots from zero", () => {
    const slots = createSlotAllocator();
    expect([slots.allocate(), slots.allocate(), slots.allocate()]).toEqual([
      0, 1, 2,
    ]);
    expect(slots.capacity).toBe(3);
  });

  it("reuses released slots before growing", () => {
    const slots = createSlotAllocator();
    slots.allocate();
    const b = slots.allocate();
    slots.allocate();
    slots.release(b);
    expect(slots.allocate()).toBe(b);
    expect(slots.capacity).toBe(3);
  });

  it("capacity is monotonic and counts the high-water mark", () => {
    const slots = createSlotAllocator();
    for (let i = 0; i < 10; i += 1) slots.allocate();
    for (let i = 0; i < 10; i += 1) slots.release(i);
    expect(slots.capacity).toBe(10);
    for (let i = 0; i < 10; i += 1) slots.allocate();
    expect(slots.capacity).toBe(10);
  });

  it("throws on double release", () => {
    const slots = createSlotAllocator();
    const a = slots.allocate();
    slots.release(a);
    expect(() => slots.release(a)).toThrow(/released|live/i);
  });

  it("throws on releasing a never-allocated slot", () => {
    const slots = createSlotAllocator();
    expect(() => slots.release(5)).toThrow();
  });
});
