/** Real Android intents, WebView, file grants, activity recreation and process death.
 * Uses an external camera/picker fixture, not a Capacitor JS mock or a physical lens.
 * Run ONLY on the disposable emulator after android-device-check.sh. */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const pkg = "pl.broniarek.gardenmanager";
const adb = (...args) =>
  execFileSync("adb", args, { encoding: "utf8", timeout: 20000 }).trim();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(action, description) {
  const end = Date.now() + 40000;
  let last;
  while (Date.now() < end) {
    try {
      const r = await action();
      if (r) return r;
    } catch (e) {
      last = e;
    }
    await pause(250);
  }
  throw new Error(`Timed out: ${description}: ${last || ""}`);
}
async function attach() {
  return until(async () => {
    const pid = adb("shell", "pidof", pkg).split(" ")[0];
    if (!pid) return;
    const sockets = adb("shell", "cat", "/proc/net/unix");
    const socket = sockets
      .split("\n")
      .map((l) => l.split("@")[1])
      .find((s) => s === `webview_devtools_remote_${pid}`);
    if (!socket) return;
    adb("forward", "tcp:9222", `localabstract:${socket}`);
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { noDefaults: true });
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) {
      await browser.close();
      return;
    }
    await page.locator(".app-shell").waitFor({ timeout: 15000 });
    return { browser, page, pid };
  }, "attach to real WebView");
}
async function tapText(text, optional = false) {
  try {
    return await until(() => {
      adb("shell", "uiautomator", "dump", "/sdcard/gm-camera-window.xml");
      const xml = adb("shell", "cat", "/sdcard/gm-camera-window.xml");
      const nodes = xml.match(/<node\b[^>]*>/g) || [];
      for (const node of nodes)
        if (node.includes(`text="${text}"`)) {
          const b = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
          if (!b) continue;
          adb(
            "shell",
            "input",
            "tap",
            String(Math.round((+b[1] + +b[3]) / 2)),
            String(Math.round((+b[2] + +b[4]) / 2)),
          );
          return true;
        }
    }, `tap ${text}`);
  } catch (e) {
    if (!optional) throw e;
  }
}
const state = (page) =>
  page.evaluate(
    () =>
      new Promise((ok, no) => {
        const r = indexedDB.open("garden-manager-state", 1);
        r.onerror = () => no(r.error);
        r.onsuccess = () => {
          const db = r.result,
            t = db.transaction("state"),
            get = t.objectStore("state").get("current");
          get.onsuccess = () => ok(get.result.data);
          t.oncomplete = () => db.close();
        };
      }),
  );
// Deterministic external handlers on a disposable emulator only. Never disable
// applications on the user's phone or change the production intent component.
assert.equal(adb('shell','getprop','ro.kernel.qemu'), '1', 'This script requires a disposable emulator');
console.log('FIXTURE PACKAGE: '+adb('shell','dumpsys','package',pkg+'.fixture').split('\n').filter(l=>/User 0:/.test(l)).join(' '));
// Newly installed packages are stopped and excluded from implicit intents until
// first use. Start only the external test fixture explicitly, then return.
adb('shell','am','start','-n',pkg+'.fixture/.CaptureActivity');
adb('shell','input','keyevent','4');
assert(adb('shell','cmd','package','query-activities','--brief','-a','android.media.action.IMAGE_CAPTURE').includes(pkg+'.fixture'), 'Camera fixture must resolve before the production intent is launched');

for (const options of [['-a','android.media.action.IMAGE_CAPTURE'], ['-a','android.intent.action.OPEN_DOCUMENT','-c','android.intent.category.OPENABLE','-t','image/*']]) {
  const components = adb('shell','cmd','package','query-activities','--brief',...options).split('\n');
  for (const component of components) {
    const match = component.trim().match(/^([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.$]+$/);
    if (match && match[1] !== pkg+'.fixture' && match[1] !== 'android') {
      console.log('EMULATOR ONLY: disable alternate intent handler '+match[1]);
      adb('shell','pm','disable-user','--user','0',match[1]);
    }
  }
}
const results = [];
try {
  for (const mode of [
    "normal",
    "activity",
    "process",
    "gallery-process",
    "cancel",
  ]) {
    adb(
      "shell",
      "settings",
      "put",
      "global",
      "always_finish_activities",
      mode === "activity" ? "1" : "0",
    );
    adb("shell", "am", "start", "-n", `${pkg}/.MainActivity`);
    let connection = await attach(),
      { page } = connection;
    const originalPid = connection.pid;
    await page.evaluate(() => {
      location.hash = "#field?field=field-today";
    });
    await page.locator(".field-visit").waitFor();
    const before = await state(page);
    const gallery = mode === "gallery-process";
    if (gallery) {
      await page
        .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
        .click();
      await page.getByLabel("Zdjęcia z urządzenia", { exact: true }).click();
    } else
      await page
        .getByRole("button", { name: "Zrób zdjęcie", exact: true })
        .click({noWaitAfter:true}).catch(error => {
          if (mode !== 'activity' || !/target.*closed|context.*destroyed/i.test(error.message)) throw error;
          console.log('Expected WebView detach during activity recreation; validating the external result next.');
        });
    // A chooser may be present; inspect the actual foreground window rather than
    // assuming the intent was resolved synchronously by Android.
    await until(async () => {
      if (
        /mCurrentFocus=.*gardenmanager.fixture/.test(
          adb("shell", "dumpsys", "window", "windows"),
        )
      )
        return true;
      adb("shell", "uiautomator", "dump", "/sdcard/gm-camera-window.xml");
      const xml = adb("shell", "cat", "/sdcard/gm-camera-window.xml");
      if (xml.includes('package="'+pkg+'.fixture"')) return true;
      if (xml.includes('text="GM Camera fixture"'))
        await tapText("GM Camera fixture");
      if (xml.includes('text="Just once"')) await tapText("Just once");
      return false;
    }, "external camera/picker in foreground");
    if (mode === "process" || gallery) {
      await connection.browser.close();
      adb("shell", "am", "kill", pkg);
      await until(() => {
        try {
          return !adb("shell", "pidof", pkg);
        } catch {
          return true;
        }
      }, "application PID terminated while camera is foreground");
    }
    await tapText(mode === "cancel" ? "CANCEL GM PHOTO" : "CONFIRM GM PHOTO");
    if (mode !== "normal" && mode !== "cancel") {
      await connection.browser.close().catch(() => {});
      connection = await attach();
      page = connection.page;
    }
    if (mode === "process" || gallery)
      assert.notEqual(
        connection.pid,
        originalPid,
        "process-death test must obtain a new PID",
      );
    if (mode === "cancel") {
      await until(
        async () =>
          !(await page.evaluate(
            () => document.documentElement.getAttribute("aria-busy") === "true",
          )),
        "camera cancel completion",
      );
      assert.equal((await state(page)).photos.length, before.photos.length);
    } else {
      await page
        .getByText(new RegExp(`Wybrano ${gallery ? 2 : 1} zdjęć`))
        .waitFor({ timeout: 30000 });
      assert.equal(
        (await state(page)).photos.length,
        before.photos.length,
        "must not commit before explicit Save",
      );
      assert.equal(
        await page.getByLabel(/^Zlecenie zdjęcia/).inputValue(),
        "field-today",
      );
      await page
        .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
        .click();
      await until(
        async () =>
          (await state(page)).photos.length ===
          before.photos.length + (gallery ? 2 : 1),
        "explicit photo commit",
      );
      const after = await state(page),
        added = after.photos.filter(
          (p) => !before.photos.some((old) => old.id === p.id),
        );
      assert(
        added.every(
          (p) =>
            p.jobId === "field-today" &&
            p.gardenId ===
              before.jobs.find((j) => j.id === "field-today").gardenId,
        ),
      );
      assert.equal(
        new Set(after.photos.map((p) => p.id)).size,
        after.photos.length,
      );
      await page.reload();
      await page.locator(".app-shell").waitFor();
      assert.equal((await state(page)).photos.length, after.photos.length);
    }
    assert.equal(
      await page
        .locator(".native-notice")
        .filter({ hasText: "po zamknięciu procesu" })
        .count(),
      0,
    );
    if (mode === 'activity') assert.equal(connection.pid, originalPid, 'Activity-only recreation must keep the same PID');
    results.push({ mode, passed: true, originalPid, returnedPid: connection.pid });
    console.log(`NATIVE CAMERA PASS: ${mode}`);
    await connection.browser.close();
  }
} catch (error) {
  writeFileSync('artifacts/android-camera-logcat.txt', adb('logcat', '-d', '-t', '2000'));
  writeFileSync('artifacts/android-camera-failure.png', execFileSync('adb', ['exec-out', 'screencap', '-p'], {timeout:20000}));
  try { adb('shell','uiautomator','dump','/sdcard/gm-camera-window.xml');const xml=adb('shell','cat','/sdcard/gm-camera-window.xml');writeFileSync('artifacts/android-camera-window.xml',xml);console.log('NATIVE FAILURE UI: '+xml); } catch {}
  throw error;
} finally {
  adb("shell", "settings", "put", "global", "always_finish_activities", "0");
  writeFileSync(
    "artifacts/android-camera-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
}
