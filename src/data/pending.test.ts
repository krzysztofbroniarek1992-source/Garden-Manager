import { it, expect } from "vitest";
import { pendingWrite, hasPendingWrites } from "./pending";
it("keeps a write pending until durable completion", async () => {
  let release!: () => void;
  const save = pendingWrite(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  expect(hasPendingWrites()).toBe(true);
  release();
  await save;
  expect(hasPendingWrites()).toBe(false);
});
it("releases the pending guard after failure", async () => {
  await expect(
    pendingWrite(async () => {
      throw new Error("abort");
    }),
  ).rejects.toThrow("abort");
  expect(hasPendingWrites()).toBe(false);
});
it("does not release the guard while another write is still pending", async () => {
  let a!: () => void, b!: () => void;
  const first = pendingWrite(
      () =>
        new Promise<void>((r) => {
          a = r;
        }),
    ),
    second = pendingWrite(
      () =>
        new Promise<void>((r) => {
          b = r;
        }),
    );
  a();
  await first;
  expect(hasPendingWrites()).toBe(true);
  b();
  await second;
  expect(hasPendingWrites()).toBe(false);
});
