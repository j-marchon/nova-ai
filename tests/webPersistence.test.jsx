// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://nova.test/"}
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.jsx";
import { WebUpdate } from "../src/components/WebUpdate.jsx";
import { emptyData } from "../src/lib/data.js";
import { loadData, saveData } from "../src/lib/storage.js";
import { clearActivity, startActivity } from "../src/lib/activity.js";
import { gsap, settleMotion } from "../src/components/motion/runtime.js";
import { saveFile } from "../src/lib/cards.js";
import { makeBackup, readBackup } from "../src/lib/backup.js";
import { StorageReadError } from "../src/lib/storage.js";

const captured = vi.hoisted(() => ({ page: null }));
vi.mock("../src/pages/CreatePage.jsx", () => ({ CreatePage: props => { captured.page = props; return <p>{props.data.username}</p>; } }));
vi.mock("../src/pages/HistoryPage.jsx", () => ({ HistoryPage: () => null }));
vi.mock("../src/pages/SettingsPage.jsx", () => ({ SettingsPage: () => null }));
vi.mock("../src/lib/cards.js", async original => ({ ...await original(), saveFile: vi.fn() }));
vi.mock("../src/lib/storage.js", async original => ({
  ...await original(), loadData: vi.fn(), saveData: vi.fn(), askForPersistence: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, worker, serviceWorker;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const render = async ui => { await act(async () => root.render(ui)); };
const click = async text => {
  const button = [...host.querySelectorAll("button")].find(el => el.textContent.trim() === text);
  expect(button, text).toBeTruthy();
  await act(async () => button.click());
};

beforeEach(() => {
  vi.clearAllMocks();
  clearActivity();
  captured.page = null;
  const data = structuredClone(emptyData);
  data.settings.dailyBackup = false;
  data.appearance.motion = "off";
  loadData.mockReset().mockResolvedValue(data);
  saveData.mockReset().mockResolvedValue(undefined);
  saveFile.mockReset().mockResolvedValue("Downloads/backup.json");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.requestIdleCallback = vi.fn(() => 1);
  window.cancelIdleCallback = vi.fn();
  worker = { postMessage: vi.fn() };
  serviceWorker = { register: vi.fn().mockResolvedValue({ waiting: null, addEventListener() {}, removeEventListener() {} }), addEventListener: vi.fn() };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); clearActivity(); settleMotion(); gsap.globalTimeline.clear();
  delete window.requestIdleCallback;
  delete window.cancelIdleCallback;
  delete navigator.serviceWorker;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("App durable persistence", () => {
  it("updates current data immediately but resolves durable update only after storage completes", async () => {
    const write = deferred();
    saveData.mockReturnValueOnce(write.promise);
    await render(<App />);
    let result;
    await act(async () => { result = captured.page.update(d => ({ ...d, username: "Restored" }), { durable: true }); });
    const settled = vi.fn(); result.then(settled);
    expect(captured.page.data.username).toBe("Restored");
    expect(saveData).toHaveBeenCalledWith(captured.page.data);
    expect(settled).not.toHaveBeenCalled();
    await act(async () => { write.resolve(); await result; });
    expect(settled).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("rejects a failed durable save and retries the same current data before clearing its warning", async () => {
    const write = deferred(), retry = deferred();
    saveData.mockReturnValueOnce(write.promise).mockReturnValueOnce(retry.promise);
    await render(<App />);
    let result;
    await act(async () => { result = captured.page.update({ username: "Keep this data" }, { durable: true }); });
    const failure = new Error("Storage quota exceeded");
    const rejected = result.catch(error => error);
    await act(async () => { write.reject(failure); await rejected; });
    expect(await rejected).toBe(failure);
    expect(host.querySelector('[role="alert"]').textContent).toContain("Changes not saved");
    expect(captured.page.data.username).toBe("Keep this data");
    await click("Retry");
    expect(saveData).toHaveBeenNthCalledWith(2, captured.page.data);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => retry.resolve());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("cancels a pending debounced write when a durable replacement arrives", async () => {
    await render(<App />);
    await act(async () => captured.page.update({ username: "Pending edit" }));
    await act(async () => { await captured.page.update(d => ({ ...d, username: "Replacement" }), { durable: true }); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 380)); });
    expect(saveData).toHaveBeenCalledOnce();
    expect(saveData.mock.calls[0][0].username).toBe("Replacement");
  });

  it("can export the data from before a failed restore", async () => {
    const initial = structuredClone(emptyData);
    initial.username = "Before restore";
    initial.settings.dailyBackup = false;
    initial.appearance.motion = "off";
    loadData.mockResolvedValueOnce(initial);
    saveData.mockRejectedValueOnce(new Error("Storage full"));
    await render(<App />);
    await act(async () => { await captured.page.update({ username: "After restore" }, { durable: true }).catch(() => {}); });
    expect(captured.page.data.username).toBe("After restore");
    await click("Export data from before restore");
    /* the backup goes to saveFile in pieces, never as one string */
    const parts = saveFile.mock.calls[0][1];
    expect(typeof parts).not.toBe("string");
    expect(readBackup([...parts].join("")).state.username).toBe("Before restore");
  });

  it("does not let an older completed write clear a newer failed save", async () => {
    const older = deferred(), newer = deferred();
    saveData.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await render(<App />);
    let first, second;
    await act(async () => { first = captured.page.update({ username: "Older" }, { durable: true }); });
    await act(async () => { second = captured.page.update({ username: "Newest" }, { durable: true }); });
    const rejected = second.catch(error => error);
    await act(async () => { newer.reject(new Error("Save failed")); await rejected; });
    await act(async () => { older.resolve(); await first; });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await click("Retry");
    expect(saveData.mock.calls.at(-1)[0].username).toBe("Newest");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("saves edits made during update preparation before activating the new release", async () => {
    const first = deferred(), latest = deferred();
    saveData.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    serviceWorker.register.mockResolvedValue({ waiting: worker, addEventListener() {}, removeEventListener() {} });
    await render(<App />);
    await click("Update");
    await act(async () => captured.page.update({ username: "Edited during save" }));
    await act(async () => first.resolve());
    expect(saveData).toHaveBeenCalledTimes(2);
    expect(saveData.mock.calls[1][0].username).toBe("Edited during save");
    expect(worker.postMessage).not.toHaveBeenCalled();
    await act(async () => latest.resolve());
    expect(worker.postMessage).toHaveBeenCalledWith("ACTIVATE");
  });
});

describe("WebUpdate activation guard", () => {
  const showUpdate = async prepare => {
    serviceWorker.register.mockResolvedValue({ waiting: worker, addEventListener() {}, removeEventListener() {} });
    await render(<WebUpdate prepare={prepare} />);
  };

  it("blocks activation while model activity is running", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    startActivity({ kind: "reply", label: "Active request", owner: { chatId: "c1" } });
    await showUpdate(prepare);
    await click("Update");
    expect(prepare).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Finish or cancel active requests");
  });

  it("does not activate after a save rejection and allows a successful retry", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new Error("Storage full")).mockResolvedValueOnce(undefined);
    await showUpdate(prepare);
    await click("Update");
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Save failed. Retry or export your data");
    await click("Update");
    expect(worker.postMessage).toHaveBeenCalledWith("ACTIVATE");
  });

  it("waits for the save promise before sending activation", async () => {
    const write = deferred();
    await showUpdate(() => write.promise);
    await click("Update");
    expect(worker.postMessage).not.toHaveBeenCalled();
    await act(async () => write.resolve());
    expect(worker.postMessage).toHaveBeenCalledWith("ACTIVATE");
  });

  it("blocks activation when a model request starts while the save is pending", async () => {
    const write = deferred();
    await showUpdate(() => write.promise);
    await click("Update");
    startActivity({ kind: "reply", label: "New request", owner: { chatId: "c1" } });
    await act(async () => write.resolve());
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(serviceWorker.addEventListener).not.toHaveBeenCalledWith("controllerchange", expect.any(Function), expect.anything());
    expect(host.textContent).toContain("Finish or cancel active requests");
  });
});

describe("App when stored data cannot be read", () => {
  const failure = () => new StorageReadError("Nova could not read its saved data.", { cause: new Error("disk I/O error") });

  it("shows the recovery screen instead of the app, saves nothing, and retries", async () => {
    loadData.mockRejectedValueOnce(failure());
    await render(<App />);
    expect(host.textContent).toContain("Nova could not read its saved data");
    expect(host.textContent).toContain("Nothing was changed");
    expect(captured.page).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
    expect(saveData).not.toHaveBeenCalled();
    await click("Retry");
    expect(loadData).toHaveBeenCalledTimes(2);
    expect(captured.page).not.toBeNull();
    expect(saveData).not.toHaveBeenCalled();
  });

  it("restores a backup file from the recovery screen as a replacement", async () => {
    loadData.mockRejectedValueOnce(failure());
    const backup = structuredClone(emptyData);
    backup.username = "From backup";
    backup.settings.dailyBackup = false;
    backup.appearance.motion = "off";
    backup.characters = [{ id: "c1", name: "Mira" }];
    await render(<App />);
    const input = host.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [{ text: async () => makeBackup(backup, "test") }] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.textContent).toContain("1 character");
    await click("Restore");
    expect(saveData).toHaveBeenCalledOnce();
    expect(saveData.mock.calls[0][1]).toEqual({ replace: true });
    expect(saveData.mock.calls[0][0].username).toBe("From backup");
    expect(captured.page.data.username).toBe("From backup");
  });

  it("explains a file that is not a backup without leaving the screen", async () => {
    loadData.mockRejectedValueOnce(failure());
    await render(<App />);
    const input = host.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [{ text: async () => "not json" }] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.textContent).toContain("That file is not a Nova backup.");
    expect(saveData).not.toHaveBeenCalled();
  });
});

