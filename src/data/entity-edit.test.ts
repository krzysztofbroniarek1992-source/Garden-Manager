import { describe, it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AtomicRepository } from "./atomic";
import { STORAGE_KEY, STORAGE_VERSION, validateData } from "./repository";
import { GardenStore } from "./store";
import type { Data } from "../domain";
import { fieldData, fieldClock } from "../../tests/field-fixture";
const cases = [
  {
    name: "client",
    get: (d: Data) => d.clients.find((c) => c.id === "client-1")!,
    patch: { phone: "600111222" },
    second: { notes: "older client draft" },
    save: (s: GardenStore, r: any, e: any) => s.saveClient(r, e),
  },
  {
    name: "garden",
    get: (d: Data) => d.gardens.find((g) => g.id === "garden-1")!,
    patch: { address: "Nowszy adres 18" },
    second: { notes: "older garden draft" },
    save: (s: GardenStore, r: any, e: any) => s.saveGarden(r, e),
  },
  {
    name: "zone",
    get: (d: Data) => d.gardens.find((g) => g.id === "garden-1")!.zones[0],
    patch: { plants: "Nowszy opis roślin" },
    second: { requirements: "older zone draft" },
    save: (s: GardenStore, r: any, e: any) => s.saveZone("garden-1", r, e),
  },
  {
    name: "catalog",
    get: (d: Data) => d.materialCatalog[0],
    patch: { purchaseUnitPrice: 18.5 },
    second: { notes: "older catalog draft" },
    save: (s: GardenStore, r: any, e: any) => s.saveCatalogMaterial(r, e),
  },
];
function setup() {
  const source = fieldData(),
    values = new Map([
      [STORAGE_KEY, JSON.stringify({ version: 10, data: source })],
    ]),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
    },
    factory = new IDBFactory();
  return {
    source,
    values,
    a: new AtomicRepository(storage, factory, "entity-edit"),
    b: new AtomicRepository(storage, factory, "entity-edit"),
  };
}
describe.each(cases)("GM-008 optimistic edit: $name", (row) => {
  it("rejects an older edit in a second authoritative transaction without touching any newer data", async () => {
    const { a, b } = setup();
    try {
      const first = await a.initialize();
      await b.initialize();
      const original = row.get(first.data);
      await b.command((s) =>
        row.save(s, { ...original, ...row.patch }, original),
      );
      const current = await b.read();
      await expect(
        a.command((s) => row.save(s, { ...original, ...row.second }, original)),
      ).rejects.toThrow(/innej karcie/);
      expect(await a.read()).toEqual(current);
    } finally {
      await a.close();
      await b.close();
    }
  });
  it("allows one winner among simultaneous edits with the same baseline", async () => {
    const { a, b } = setup();
    try {
      const first = await a.initialize();
      await b.initialize();
      const original = row.get(first.data);
      const results = await Promise.allSettled([
        a.command((s) => row.save(s, { ...original, ...row.patch }, original)),
        b.command((s) => row.save(s, { ...original, ...row.second }, original)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      validateData((await a.read()).data);
    } finally {
      await a.close();
      await b.close();
    }
  });
  it("distinguishes explicit creation from an update and rejects duplicate IDs without overwriting", async () => {
    const { a, b } = setup();
    try {
      const first = await a.initialize();
      await b.initialize();
      const fresh = { ...row.get(first.data), id: "new-entity" };
      await a.command((s) => row.save(s, fresh, null));
      const current = await a.read();
      await expect(
        b.command((s) => row.save(s, { ...fresh, ...row.patch }, null)),
      ).rejects.toThrow(/innej karcie/);
      expect(await b.read()).toEqual(current);
    } finally {
      await a.close();
      await b.close();
    }
  });
  it("does not recreate an entity removed by a later snapshot restore", async () => {
    const { a, b } = setup();
    try {
      const initial = await a.initialize();
      await b.initialize();
      const fresh = { ...row.get(initial.data), id: "to-remove" };
      await a.command((s) => row.save(s, fresh, null));
      const current = (await b.read()).data,
        replacement = structuredClone(current);
      replacement.clients = replacement.clients.filter(
        (r) => r.id !== fresh.id,
      );
      replacement.gardens = replacement.gardens
        .filter((r) => r.id !== fresh.id)
        .map((g) => ({
          ...g,
          zones: g.zones.filter((r) => r.id !== fresh.id),
        }));
      replacement.materialCatalog = replacement.materialCatalog.filter(
        (r) => r.id !== fresh.id,
      );
      await b.command((s) =>
        s.restoreSnapshot(replacement, JSON.stringify(current)),
      );
      const after = await b.read();
      await expect(
        a.command((s) => row.save(s, { ...fresh, ...row.patch }, fresh)),
      ).rejects.toThrow(/innej karcie/);
      expect(await a.read()).toEqual(after);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
describe("GM-008 independent fields and unchanged persistence contract", () => {
  it("merges garden metadata and independent zone edits, preserving current zones and history", async () => {
    const { a, b, source } = setup();
    try {
      await a.initialize();
      await b.initialize();
      const garden = source.gardens.find((g) => g.id === "garden-1")!,
        zone = garden.zones[0];
      await b.command((s) =>
        s.saveZone(garden.id, { ...zone, plants: "Nowsze rośliny" }, zone),
      );
      await a.command((s) =>
        s.saveGarden({ ...garden, address: "Nowy adres" }, garden),
      );
      const next = (await a.read()).data;
      expect(next.gardens.find((g) => g.id === garden.id)).toEqual({
        ...garden,
        address: "Nowy adres",
        zones: garden.zones.map((z) =>
          z.id === zone.id ? { ...z, plants: "Nowsze rośliny" } : z,
        ),
      });
      for (const key of [
        "jobs",
        "payments",
        "timer",
        "photos",
        "notes",
        "taskSchedules",
        "taskOccurrences",
        "reportSequence",
        "availability",
        "checklists",
      ] as const)
        expect(next[key]).toEqual(source[key]);
      validateData(next);
    } finally {
      await a.close();
      await b.close();
    }
  });
  it("preserves the current format and exact business snapshot on bootstrap without adding revisions to entities", async () => {
    const { a, source, values } = setup();
    try {
      expect((await a.initialize()).data).toEqual(source);
      expect(STORAGE_VERSION).toBe(11);
      expect(JSON.parse(values.get(STORAGE_KEY)!).version).toBe(STORAGE_VERSION);
      const client = source.clients[0];
      await a.command((s) =>
        s.saveClient({ ...client, phone: "600000000" }, client),
      );
      expect(Object.keys((await a.read()).data.clients[0])).toEqual(
        Object.keys(client),
      );
    } finally {
      await a.close();
    }
  });
});
