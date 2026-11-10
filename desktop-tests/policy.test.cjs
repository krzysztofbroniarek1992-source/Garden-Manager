const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const p = require("../desktop/build/policy.cjs");
test("fixed private origin only, never external or alternate hosts", () => {
  for (const u of [
    "app://garden-manager/",
    "app://garden-manager/#clients?client=1",
  ])
    assert.equal(p.entryUrl(u), true);
  for (const u of [
    "file:///etc/passwd",
    "https://garden-manager/",
    "app://garden-manager.evil/",
    "app://user@garden-manager/",
    "app://garden-manager:8080/",
    "app://garden-manager/desktop/main.cjs",
    "data:text/html,x",
  ])
    assert.equal(p.entryUrl(u), false);
});
test("asset resolution cannot escape its own directory with percent encodings or Windows separators", () => {
  const root = path.resolve("app-assets");
  assert.equal(p.assetPath(p.ORIGIN, root), path.join(root, "index.html"));
  for (const u of [
    "app://garden-manager/%2e%2e%2fprivate",
    "app://garden-manager/%5c..%5cprivate",
    "app://garden-manager/%00",
    "app://garden-manager/%ZZ",
    "app://other/index.html",
  ])
    assert.throws(() => p.assetPath(u, root));
  assert.equal(p.inside(root, path.resolve(root, "../private")), false);
  assert.equal(p.inside(root, path.resolve(root + "-other/index.html")), false);
});
test("strict IPC payload, bounded offsets and export MIME/extension validation", () => {
  assert.throws(() => p.payload({ name: "x", path: "C:/secret" }, ["name"]));
  for (const n of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => p.integer(n, p.MAX_FILE));
  assert.equal(p.integer(p.MAX_FILE, p.MAX_FILE), p.MAX_FILE);
  assert.throws(() =>
    p.saveOptions({ name: "a.exe", mime: "application/pdf", size: 2 }),
  );
  assert.throws(() =>
    p.saveOptions({ name: "a.pdf", mime: "text/html", size: 2 }),
  );
  assert.throws(() =>
    p.saveOptions({
      name: "a.pdf",
      mime: "application/pdf",
      size: p.MAX_FILE + 1,
    }),
  );
  assert.equal(
    p.saveOptions({ name: "Łódź.pdf", mime: "application/pdf", size: 2 }).name,
    "Łódź.pdf",
  );
});
test("offscreen and malformed geometry return to an active work area", () => {
  const area = { x: 0, y: 0, width: 1280, height: 720 };
  for (const bounds of [
    null,
    {},
    { x: 99999, y: 99999, width: 3000, height: 2000 },
  ]) {
    const r = p.windowBounds(bounds, [area]);
    assert.ok(
      r.x >= 0 && r.y >= 0 && r.x + r.width <= 1280 && r.y + r.height <= 720,
    );
  }
  const negative = { x: -1600, y: 0, width: 1600, height: 900 };
  assert.equal(
    p.windowBounds({ x: -1500, y: 20, width: 900, height: 700 }, [
      area,
      negative,
    ]).x,
    -1500,
  );
});
test("UI bookmarks contain only bounded hash addresses", () => {
  p.bookmark("#jobs?job=a&section=billing");
  for (const s of [
    "https://evil",
    "file:///C:/data",
    "#a\nscript",
    "#" + "a".repeat(16000),
  ])
    assert.throws(() => p.bookmark(s));
});
test("installer preserves stable identity and per-user data, without web updater", () => {
  const c = require("../desktop/electron-builder.cjs");
  assert.equal(c.appId, p.APP_ID);
  assert.equal(c.nsis.perMachine, false);
  assert.equal(c.nsis.allowElevation, false);
  assert.equal(c.nsis.deleteAppDataOnUninstall, false);
  assert.equal(c.asar, true);
  assert.equal(c.publish, undefined);
});
