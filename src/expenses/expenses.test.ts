import { describe, it, expect, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createDemoData } from "../data/demo";
import {
  LocalRepository,
  STORAGE_KEY,
  STORAGE_VERSION,
  validateData,
} from "../data/repository";
import { AtomicRepository } from "../data/atomic";
import { GardenStore } from "../data/store";
import {
  defaultOptions,
  reviewRows,
  rulesKey,
  suggest,
  otherCategory,
  initialExpenseData,
  type ExpenseProfile,
  type ImportRequest,
  type Expense,
} from "./model";
import {
  parseCsv,
  parseDate,
  parseMoney,
  detectDelimiter,
  decodeCsv,
  mappedRows,
  remapColumns,
  digest,
} from "./csv";
import { importExpenses, saveExpense, saveSetting } from "./commands";
import { companySummary } from "./finance";
import { makeFullBackup, readFullBackup } from "../photos/backup";
import { IndexedDbPhotoRepository } from "../photos/assets";
const profile: ExpenseProfile = {
  id: "bank-pln",
  name: "Firmowe PLN",
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  archived: false,
  headers: ["Data", "Kwota", "Kontrahent", "Opis", "ID"],
  options: {
    ...defaultOptions(),
    mapping: {
      ...defaultOptions().mapping,
      date: 0,
      amount: 1,
      counterparty: 2,
      description: 3,
      transactionId: 4,
    },
  },
};
function data() {
  return {
    ...createDemoData(new Date("2026-11-10T10:00:00Z")),
    expenseProfiles: [structuredClone(profile)],
  };
}
const header = "Data;Kwota;Kontrahent;Opis;ID\n";
async function request(
  csv: string,
  base = data(),
  id: string = crypto.randomUUID(),
  bankId = true,
): Promise<ImportRequest> {
  const o = structuredClone(profile.options);
  if (!bankId) o.mapping.transactionId = -1;
  const parsed = await mappedRows(parseCsv(header + csv, ";"), o);
  return {
    id,
    profile: base.expenseProfiles[0],
    rulesKey: rulesKey(base),
    statementKey: parsed.statementKey,
    fileHash: await digest(csv),
    filename: "wyciag.csv",
    requestKey: await digest(id + csv),
    rows: reviewRows(base, profile.id, parsed.statementKey, parsed.rows),
  };
}
const memory = (raw?: string) => {
  const values = new Map<string, string>();
  if (raw) values.set(STORAGE_KEY, raw);
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
};
const manual = (): Expense => ({
  id: "manual",
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  date: "2026-11-10",
  amountCents: 12345,
  direction: "outgoing",
  counterparty: "Serwis",
  description: "Części",
  categoryId: otherCategory,
  source: "manual",
  origin: null,
  status: "approved",
  note: "",
  history: [],
});
describe("bank CSV parsing", () => {
  it.each([";", ",", "\t", "|"])(
    "parses delimiter %j, CRLF, BOM, quoted separators, escaped quotes and newlines",
    (d) => {
      const csv = `\uFEFFData${d}Opis\r\n2026-11-10${d}"Zażółć${d} \"\"gęślą\"\"\nnowa linia"\r\n`;
      expect(detectDelimiter(csv)).toBe(d);
      expect(parseCsv(csv, d)).toEqual([
        { line: 1, cells: ["Data", "Opis"] },
        { line: 2, cells: ["2026-11-10", `Zażółć${d} "gęślą"\nnowa linia`] },
      ]);
    },
  );
  it.each(['"abc', 'a;"b"x', 'a"b;c'])("rejects malformed CSV %s", (csv) =>
    expect(() => parseCsv(csv, ";")).toThrow(),
  );
  it("enforces file, cell, column and row limits", async () => {
    expect(() => parseCsv("x".repeat(4097), ";")).toThrow();
    expect(() => parseCsv(Array(66).fill("x").join(";"), ";")).toThrow();
    expect(() => parseCsv("x\n".repeat(2053), ";")).toThrow();
    await expect(
      decodeCsv(new Blob(["x".repeat(5 * 1024 * 1024 + 1)])),
    ).rejects.toThrow("5 MB");
  });
  it.each([
    ["-1 234,56", ",", -123456],
    ["1.234,56 PLN", ",", 123456],
    ["(12,03)", ",", -1203],
    ["12,03-", ",", -1203],
    ["1,234.56", ".", 123456],
    ["90071992547409,91", ",", Number.MAX_SAFE_INTEGER],
  ] as const)("parses exact cents %s", (s, d, v) =>
    expect(parseMoney(s, d)).toBe(v),
  );
  it.each([
    "12,345",
    "1e3",
    "1.23,00",
    "USD 1,00",
    "90071992547409,92",
    "--1",
    "1,",
  ])("rejects invalid cents %s", (s) =>
    expect(() => parseMoney(s, ",")).toThrow(),
  );
  it.each([
    ["29.02.2024", "auto", "2024-02-29"],
    ["2026/11/10", "ymd", "2026-11-10"],
    ["10/11/2026", "dmy", "2026-11-10"],
    ["11/10/2026", "mdy", "2026-11-10"],
    ["2026-11-10T23:00:00Z", "auto", "2026-11-10"],
  ] as const)("parses date %s", (s, f, v) => expect(parseDate(s, f)).toBe(v));
  it.each(["29.02.2026", "31.04.2026", "11/10/26", "2026-13-01"])(
    "rejects impossible date %s",
    (s) => expect(() => parseDate(s, "auto")).toThrow(),
  );
  it("decodes UTF8, Windows1250, ISO88592 and UTF16 Polish text", async () => {
    expect((await decodeCsv(new Blob(["Łódź;żółć"]))).text).toBe("Łódź;żółć");
    const bytes = new Uint8Array([0xa3, 0xf3, 0x64, 0x9f]);
    expect((await decodeCsv(new Blob([bytes]))).text).toBe("Łódź");
    const latin = new Uint8Array([0xa3, 0xf3, 0x64, 0xbc]);
    expect((await decodeCsv(new Blob([latin]), "iso-8859-2")).text).toBe(
      "Łódź",
    );
    const utf16 = new Uint8Array([255, 254, 0x41, 1]);
    expect((await decodeCsv(new Blob([utf16]))).text).toBe("Ł");
  });
  it("maps headers by name after a column reorder, never by a guessed position", () => {
    const map = remapColumns(
      profile.headers,
      ["Opis", "Kwota", "ID", "Data", "Kontrahent"],
      profile.options.mapping,
    );
    expect(map).toMatchObject({
      date: 3,
      amount: 1,
      counterparty: 4,
      description: 0,
      transactionId: 2,
    });
    expect(
      remapColumns(profile.headers, ["Data", "Data"], profile.options.mapping)
        .date,
    ).toBe(-1);
  });
  it("split columns preserve inflows and identify invalid rows without dropping them", async () => {
    const o = {
      ...profile.options,
      mode: "split" as const,
      mapping: {
        ...defaultOptions().mapping,
        date: 0,
        debit: 1,
        credit: 2,
        currency: 3,
      },
    };
    const r = await mappedRows(
      parseCsv(
        "Data;Debit;Credit;CCY\n10.11.2026;12,30;;PLN\n11.11.2026;;50,00;PLN\n12.11.2026;1,00;2,00;PLN\n31.02.2026;1;;PLN\n12.11.2026;1;;EUR",
        ";",
      ),
      o,
    );
    expect(r.rows.map((r) => r.row?.signedCents ?? null)).toEqual([
      -1230,
      5000,
      null,
      null,
      null,
    ]);
    expect(r.rows[4].error).toContain("PLN");
  });
});
describe("expense approvals and identity", () => {
  it("proposes categories but never approves debits or bank credits automatically", async () => {
    const r = await request(
      "10.11.2026;-12,30;ORLEN;Paliwo;1\n10.11.2026;-20,00;Moje;Przelew własny;2\n10.11.2026;50,00;Klient;Wpłata;3",
    );
    expect(r.rows.map((r) => r.status)).toEqual([
      "excluded",
      "excluded",
      "excluded",
    ]);
    expect(r.rows[0].categoryId).toBe("expense-category-2");
    expect(suggest(data(), r.rows[1].row!).exclusion).toBe(true);
    const saved = importExpenses(data(), r, 100);
    expect(saved.expenses).toHaveLength(3);
    expect(saved.payments).toEqual(data().payments);
    expect(saved.expenseImports[0]).toMatchObject({ approved: 0, excluded: 3 });
  });
  it("keeps two real identical operations and detects a semantic reimport after reordering", async () => {
    const r = await request(
      "10.11.2026;-12,30;ORLEN;Paliwo;\n10.11.2026;-12,30;ORLEN;Paliwo;\n11.11.2026;-1,00;ZUS;Składki;",
      data(),
      "first",
      false,
    );
    r.rows.forEach((x) => (x.status = "approved"));
    const saved = importExpenses(data(), r, 100);
    expect(saved.expenses).toHaveLength(3);
    const again = await request(
      "11.11.2026;-1,00;ZUS;Składki;\n10.11.2026;-12,30;ORLEN;Paliwo;\n10.11.2026;-12,30;ORLEN;Paliwo;",
      saved,
      "second",
      false,
    );
    expect(again.statementKey).toBe(r.statementKey);
    expect(again.rows.every((x) => x.state === "duplicate")).toBe(true);
    expect(importExpenses(saved, again, 200).expenses).toEqual(saved.expenses);
    expect(importExpenses(saved, r, 200)).toBe(saved);
  });
  it("ambiguous overlapping extracts require a deliberate separate-operation decision", async () => {
    const r = await request(
      "10.11.2026;-12,30;ORLEN;Paliwo;",
      data(),
      "one",
      false,
    );
    const saved = importExpenses(data(), r, 100);
    const overlap = await request(
      "10.11.2026;-12,30;ORLEN;Paliwo;\n11.11.2026;-20,00;ZUS;Składki;",
      saved,
      "two",
      false,
    );
    expect(overlap.rows[0]).toMatchObject({
      state: "ambiguous",
      selected: false,
    });
    overlap.rows[0].selected = true;
    expect(() => importExpenses(saved, overlap, 200)).toThrow("osobną");
    overlap.rows[0].separate = true;
    expect(importExpenses(saved, overlap, 200).expenses).toHaveLength(3);
  });
  it("bank IDs deduplicate across extracts, detect conflicts and are scoped to the profile", async () => {
    const r = await request("10.11.2026;-12,30;ORLEN;Paliwo;ID-1");
    const saved = importExpenses(data(), r, 100);
    const other = await request("10.11.2026;-99,30;ORLEN;Paliwo;ID-1", saved);
    expect(other.rows[0].state).toBe("conflict");
    expect(() => importExpenses(saved, other, 200)).toThrow("inne dane");
    const separate = {
      ...data(),
      expenseProfiles: [{ ...profile, id: "other-bank" }],
    };
    const parsed = await mappedRows(
      parseCsv(header + "10.11.2026;-12,30;ORLEN;Paliwo;ID-1", ";"),
      profile.options,
    );
    expect(
      reviewRows(saved, "other-bank", parsed.statementKey, parsed.rows)[0]
        .state,
    ).toBe("new");
    expect(separate.expenseProfiles[0].id).not.toBe(profile.id);
  });
  it("manual edits use CAS, preserve origin/history, and incoming operations stay excluded", async () => {
    const original = data();
    const saved = saveExpense(original, manual(), null, 100);
    const e = saved.expenses[0];
    const changed = saveExpense(
      saved,
      { ...e, status: "excluded", note: "Zakup prywatny" },
      e,
      200,
    );
    expect(changed.expenses[0].history).toHaveLength(2);
    expect(() => saveExpense(changed, { ...e, note: "Stare" }, e, 300)).toThrow(
      "innej karcie",
    );
    expect(() => saveExpense(changed, manual(), null, 300)).toThrow();
    const r = await request("10.11.2026;50,00;Klient;Wpłata;3");
    r.rows[0].status = "approved";
    expect(importExpenses(original, r, 200).expenses[0].status).toBe(
      "excluded",
    );
    expect(() =>
      saveExpense(saved, { ...e, origin: {} as never }, e, 200),
    ).toThrow();
  });
  it("custom categories and editable rules use fresh revisions; current-format corruption is rejected", () => {
    const d = data(),
      c = { ...d.expenseCategories[0], id: "custom", name: "Transport" };
    const next = saveSetting(d, "expenseCategories", c, null, 100);
    expect(next.expenseCategories.at(-1)?.name).toBe("Transport");
    const r = {
      ...next.expenseRules[0],
      pattern: "TAXI",
      action: "category" as const,
      categoryId: c.id,
      priority: 0,
    };
    const changed = saveSetting(
      next,
      "expenseRules",
      r,
      next.expenseRules[0],
      101,
    );
    expect(
      suggest(changed, {
        line: 1,
        date: "2026-11-10",
        signedCents: -100,
        counterparty: "Taxi",
        description: "",
        transactionId: null,
        occurrence: 1,
      }).categoryId,
    ).toBe("custom");
    expect(() =>
      saveSetting(changed, "expenseRules", r, next.expenseRules[0], 102),
    ).toThrow();
    expect(() => validateData({ ...d, expenseCategories: [] })).toThrow();
    expect(() => validateData({ ...d, expenses: [null] })).toThrow();
  });
  it("summaries separate actual job payments from job value and purchases from material charges", () => {
    const d = data();
    d.expenses = [
      manual(),
      { ...manual(), id: "private", amountCents: 99999, status: "excluded" },
    ];
    const before = structuredClone(d);
    const s = companySummary(d, "2026-11", Date.parse("2026-11-10"));
    expect(s.costs).toBe(12345);
    expect(s.received).toBe(
      d.payments
        .filter((p) => p.receivedDate.startsWith("2026-11"))
        .reduce((n, p) => n + p.amountCents, 0),
    );
    expect(s.cash).toBe(s.received - 12345);
    expect(companySummary(d, "2026").costs).toBe(12345);
    expect(d).toEqual(before);
  });
});
describe("atomic persistence, migration and backups", () => {
  it("serializes simultaneous imports and unrelated writes; the stale form is rejected", async () => {
    const d = data(),
      storage = memory(JSON.stringify({ version: 11, data: d })),
      factory = new IDBFactory(),
      a = new AtomicRepository(storage, factory),
      b = new AtomicRepository(storage, factory);
    try {
      await Promise.all([a.initialize(), b.initialize()]);
      const r = await request("10.11.2026;-12,30;ORLEN;Paliwo;ID-1");
      const another = {
        ...r,
        id: "another",
        requestKey: await digest("another"),
      };
      await Promise.all([
        a.command((s) => s.importExpenses(r)),
        b.command((s) => s.importExpenses(another)),
        a.command((s) => s.setRate(177)),
      ]);
      const current = (await a.read()).data;
      expect(current.expenses).toHaveLength(1);
      expect(current.expenseImports).toHaveLength(2);
      expect(current.settings.hourlyRate).toBe(177);
      await Promise.all([
        a.command((s) => s.importExpenses(r)),
        b.command((s) => s.importExpenses(r)),
      ]);
      expect((await a.read()).data.expenseImports).toHaveLength(2);
      const expense = current.expenses[0];
      await b.command((s) =>
        s.saveExpense({ ...expense, note: "Nowe" }, expense),
      );
      await expect(
        a.command((s) => s.saveExpense({ ...expense, note: "Stare" }, expense)),
      ).rejects.toThrow("innej karcie");
      const restart = new AtomicRepository(
        memory(JSON.stringify({ version: 10, data: d })),
        factory,
      );
      expect((await restart.initialize()).data.expenses[0].note).toBe("Nowe");
      await restart.close();
    } finally {
      await a.close();
      await b.close();
    }
  });
  it("rejects a profile/rule change after preview and a stale backup restore after an import", async () => {
    const d = data(),
      r = await request("10.11.2026;-12,30;ORLEN;Paliwo;ID-1");
    expect(() => importExpenses({ ...d, expenseRules: [] }, r, 100)).toThrow(
      "innej karcie",
    );
    const storage = memory(JSON.stringify({ version: 11, data: d })),
      a = new AtomicRepository(storage, new IDBFactory());
    try {
      await a.initialize();
      await a.command((s) => s.importExpenses(r));
      await expect(
        a.command((s) => s.restoreSnapshot(d, JSON.stringify(d))),
      ).rejects.toThrow();
      expect((await a.read()).data.expenses).toHaveLength(1);
    } finally {
      await a.close();
    }
  });
  it("migrates the authoritative v10 and preserves the exact pre-migration state despite a stale mirror", async () => {
    const old = data() as any;
    for (const key of Object.keys(initialExpenseData())) delete old[key];
    const f = new IDBFactory(),
      source = { formatVersion: 10, revision: 41, data: old };
    await new Promise<void>((resolve, reject) => {
      const q = f.open("garden-manager-state", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("state");
      q.onsuccess = () => {
        const tx = q.result.transaction("state", "readwrite");
        tx.objectStore("state").put(source, "current");
        tx.oncomplete = () => {
          q.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const storage = memory(
        JSON.stringify({ version: 10, data: { ...old, clients: [] } }),
      ),
      repo = new AtomicRepository(storage, f);
    try {
      const migrated = await repo.initialize();
      expect(migrated).toEqual({
        ...source,
        formatVersion: 11,
        data: { ...old, ...initialExpenseData() },
      });
      const backup = await new Promise<any>((resolve) => {
        const q = f.open("garden-manager-state", 1);
        q.onsuccess = () => {
          const tx = q.result.transaction("state", "readonly"),
            get = tx.objectStore("state").get("format-v10-source");
          get.onsuccess = () => resolve(get.result);
          tx.oncomplete = () => q.result.close();
        };
      });
      expect(backup).toEqual(source);
      const recovered = new LocalRepository(
        memory(JSON.stringify({ version: 10, data: backup.data })),
      ).load();
      expect(recovered).toEqual(migrated.data);
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).version).toBe(11);
    } finally {
      await repo.close();
    }
  });
  it("a failed migration write leaves v10 current and its mirror intact", async () => {
    const d = data() as any;
    for (const key of Object.keys(initialExpenseData())) delete d[key];
    const raw = JSON.stringify({ version: 10, data: d }),
      storage = memory(raw),
      f = new IDBFactory();
    const put = IDBObjectStore.prototype.put;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: any,
        key?: IDBValidKey,
      ) {
        if (key === "current" && value.formatVersion === 11)
          throw new DOMException("Full", "QuotaExceededError");
        return put.call(this, value, key);
      });
    const a = new AtomicRepository(storage, f);
    try {
      await expect(a.initialize()).rejects.toThrow("Full");
      expect(storage.getItem(STORAGE_KEY)).toBe(raw);
      expect(storage.getItem("garden-manager:backup:v10")).toBeNull();
    } finally {
      spy.mockRestore();
      await a.close();
    }
  });
  it("roundtrips v11 JSON/ZIP including import decisions and reads genuine old v10 backups", async () => {
    const r = await request("10.11.2026;-12,30;ORLEN;Paliwo;ID-1");
    const d = importExpenses(data(), r, 100),
      store = new GardenStore(
        new LocalRepository(memory(JSON.stringify({ version: 11, data: d }))),
      );
    const json = JSON.stringify({
      version: STORAGE_VERSION,
      data: store.snapshot(),
    });
    expect(JSON.parse(json).version).toBe(STORAGE_VERSION);
    expect(new LocalRepository(memory(json)).load()).toEqual(d);
    const assets = new IndexedDbPhotoRepository(new IDBFactory());
    const zip = await makeFullBackup(d, assets);
    expect((await readFullBackup(zip)).data).toEqual(d);
    const old = data() as any;
    for (const key of Object.keys(initialExpenseData())) delete old[key];
    expect(
      new LocalRepository(
        memory(JSON.stringify({ version: 10, data: old })),
      ).load(),
    ).toEqual({ ...old, ...initialExpenseData() });
  });
});
describe("v10 authority abort safety", () => {
  for (const target of ["current", "format-v10-source"])
    it(`rolls back the entire migration when ${target} cannot be written`, async () => {
      const old = data() as any;
      for (const key of Object.keys(initialExpenseData())) delete old[key];
      const source = { formatVersion: 10, revision: 77, data: old },
        factory = new IDBFactory();
      const raw = async () =>
        new Promise<any>((resolve) => {
          const q = factory.open("garden-manager-state", 1);
          q.onsuccess = () => {
            const tx = q.result.transaction("state"),
              a = tx.objectStore("state").get("current"),
              b = tx.objectStore("state").get("format-v10-source");
            tx.oncomplete = () => {
              q.result.close();
              resolve({ current: a.result, backup: b.result });
            };
          };
        });
      await new Promise<void>((resolve) => {
        const q = factory.open("garden-manager-state", 1);
        q.onupgradeneeded = () => q.result.createObjectStore("state");
        q.onsuccess = () => {
          const tx = q.result.transaction("state", "readwrite");
          tx.objectStore("state").put(source, "current");
          tx.oncomplete = () => {
            q.result.close();
            resolve();
          };
        };
      });
      const storage = memory("stale mirror"),
        repo = new AtomicRepository(storage, factory);
      const original = IDBObjectStore.prototype.put,
        spy = vi
          .spyOn(IDBObjectStore.prototype, "put")
          .mockImplementation(function (
            this: IDBObjectStore,
            value: any,
            key?: IDBValidKey,
          ) {
            if (key === target)
              throw new DOMException("Full", "QuotaExceededError");
            return original.call(this, value, key);
          });
      try {
        await expect(repo.initialize()).rejects.toThrow();
        expect(await raw()).toEqual({ current: source, backup: undefined });
        expect(storage.getItem(STORAGE_KEY)).toBe("stale mirror");
      } finally {
        spy.mockRestore();
        await repo.close();
      }
    });
  it("full v10 ZIP without expense fields upgrades while v11 missing collections fails closed", async () => {
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const assets = new IndexedDbPhotoRepository(new IDBFactory());
    const files = unzipSync(
      new Uint8Array(
        await (await makeFullBackup(data(), assets)).arrayBuffer(),
      ),
    );
    const envelope = JSON.parse(strFromU8(files["data.json"]));
    envelope.version = 10;
    for (const key of Object.keys(initialExpenseData()))
      delete envelope.data[key];
    files["data.json"] = strToU8(JSON.stringify(envelope));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    manifest.dataSha256 = await digest(
      files["data.json"].slice().buffer as ArrayBuffer,
    );
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    expect(
      (
        await readFullBackup(
          new Blob([zipSync(files).slice().buffer as ArrayBuffer]),
        )
      ).data,
    ).toEqual({ ...envelope.data, ...initialExpenseData() });
    expect(() =>
      new LocalRepository(
        memory(JSON.stringify({ version: 11, data: envelope.data })),
      ).load(),
    ).toThrow("rejestr");
  });
});
