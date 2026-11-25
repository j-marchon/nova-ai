// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupPanel } from "../src/components/BackupPanel.jsx";
import { Modal } from "../src/components/ui.jsx";
import { setMotionPreference } from "../src/components/motion/runtime.js";
import { emptyData } from "../src/lib/data.js";
import { CreatePage } from "../src/pages/CreatePage.jsx";
import { version } from "../package.json";

const mocks = vi.hoisted(() => ({
  save: vi.fn(), make: vi.fn(), parts: vi.fn(), read: vi.fn(), cancel: vi.fn(),
}));
vi.mock("../src/lib/cards.js", async original => ({ ...await original(), saveFile: mocks.save }));
vi.mock("../src/lib/backup.js", async original => ({ ...await original(), makeBackup: mocks.make, backupParts: mocks.parts, readBackup: mocks.read }));
vi.mock("../src/lib/activity.js", async original => ({ ...await original(), cancelWhere: mocks.cancel }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
const render = async ui => { await act(async () => root.render(ui)); };
/* the panel waits a frame before heavy work so its busy label can paint */
const frame = () => new Promise(resolve => setTimeout(resolve, 150));
const click = async button => { await act(async () => { button.click(); await frame(); }); };
const button = text => [...host.querySelectorAll("button")].find(el => el.textContent.trim() === text);
const pick = async () => {
  const input = host.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [{ text: async () => "backup" }] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await frame(); });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.make.mockReturnValue("exported");
  mocks.parts.mockReturnValue(["exported"]);
  mocks.save.mockResolvedValue("Downloads/nova.json");
  mocks.read.mockReturnValue({ state: emptyData, createdAt: null });
  Object.defineProperty(navigator, "storage", { configurable: true, value: { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) } });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  setMotionPreference("off");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

describe("web backup controls", () => {
  it("exports without credentials unless explicitly enabled, and hides native daily backups", async () => {
    const update = vi.fn();
    await render(<BackupPanel data={emptyData} update={update} />);
    expect(host.textContent).not.toContain("Daily backup");
    expect(host.textContent).toContain("Start here");
    expect(host.querySelector('a[href="./privacy.html"]')).not.toBeNull();
    await click(button("Back up now"));
    expect(mocks.parts).toHaveBeenLastCalledWith(emptyData, expect.any(String), expect.objectContaining({ includeCredentials: false }));
    expect(mocks.save).toHaveBeenLastCalledWith(expect.any(String), ["exported"], "application/json");
    expect(host.textContent).toContain("Download requested");
    /* the switch is kept in settings, so Sync's Send follows it too */
    await click(host.querySelector('[role="switch"]'));
    expect(update).toHaveBeenLastCalledWith({ settings: expect.objectContaining({ backupCredentials: true }) });
    const on = { ...emptyData, settings: { ...emptyData.settings, backupCredentials: true } };
    await render(<BackupPanel data={on} update={update} />);
    await click(button("Back up now"));
    expect(mocks.parts).toHaveBeenLastCalledWith(on, expect.any(String), expect.objectContaining({ includeCredentials: true }));
  });

  it("shows Saving with progress while the backup is written and keeps buttons disabled", async () => {
    let finish;
    mocks.parts.mockImplementation((data, v, opts) => { opts.onProgress(0.42); return ["x"]; });
    mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(<BackupPanel data={emptyData} update={vi.fn()} />);
    await click(button("Back up now"));
    const saving = [...host.querySelectorAll("button")].find(el => el.textContent.includes("Saving..."));
    expect(saving.textContent).toContain("42%");
    expect(saving.disabled).toBe(true);
    expect(button("Restore").disabled).toBe(true);
    await act(async () => finish("Downloads/nova.json"));
    expect(button("Back up now").disabled).toBe(false);
  });

  it("reports denied persistence without claiming data is protected", async () => {
    await render(<BackupPanel data={emptyData} update={vi.fn()} />);
    expect(host.textContent).toContain("Browser storage is not persistent");
    await click(button("Request persistent storage"));
    expect(host.textContent).toContain("Persistent storage was not granted");
    expect(host.textContent).toContain("Persistent storage is not a backup");
  });

  it("exports only diagnostic allowlisted fields even when private app data is present", async () => {
    const data = structuredClone(emptyData);
    data.settings.providers = [{ base: "https://private-provider.example", key: "private-key" }];
    data.chats = [{ id: "private-chat", messages: [{ content: "private-conversation" }] }];
    await render(<BackupPanel data={data} update={vi.fn()} />);
    await click(button("Export diagnostics"));
    const [name, text, mime] = mocks.save.mock.calls[0];
    expect(name).toBe("nova-diagnostics.json");
    expect(mime).toBe("application/json");
    expect(JSON.parse(text)).toEqual({
      version,
      platform: navigator.userAgentData?.platform || navigator.platform || "unknown",
      storage: { indexedDB: !!window.indexedDB, localStorage: true, persistenceApi: true, persistenceStatus: "temporary" },
    });
    expect(mocks.make).not.toHaveBeenCalled();
    expect(mocks.parts).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Diagnostic download requested");
  });

  it("reports a diagnostic download failure", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Download blocked"));
    await render(<BackupPanel data={emptyData} update={vi.fn()} />);
    await click(button("Export diagnostics"));
    expect(host.textContent).toContain("Could not export diagnostics.");
    expect(button("Export diagnostics").disabled).toBe(false);
  });

  it("cancels activity and waits for durable restore before claiming success", async () => {
    let finish;
    const update = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    await render(<BackupPanel data={emptyData} update={update} />);
    await pick();
    await click(host.querySelector('.nv-primary'));
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.cancel.mock.calls[0][0]({})).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.any(Function), { durable: true });
    expect(update.mock.calls[0][0]()).toBe(emptyData);
    expect(mocks.cancel.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    expect(host.textContent).not.toContain("Backup restored and saved");
    expect(button("Restoring...").disabled).toBe(true);
    await act(async () => finish());
    expect(host.textContent).toContain("Backup restored and saved on this device");
    expect(host.textContent).not.toContain("Replace everything");
  });

  it("keeps restore confirmation and shows a failed save without success", async () => {
    await render(<BackupPanel data={emptyData} update={vi.fn().mockRejectedValue(new Error("Storage is full."))} />);
    await pick();
    await click(host.querySelector('.nv-primary'));
    expect(host.textContent).toContain("Storage is full.");
    expect(host.textContent).toContain("Replace everything");
    expect(host.textContent).not.toContain("Backup restored and saved");
    expect(host.querySelector('.nv-primary').disabled).toBe(false);
  });
});

describe("first use", () => {
  it("shows no setup checklist on an empty Create page", async () => {
    const props = { data: emptyData, update: vi.fn(), onEdit: vi.fn(), startChat: vi.fn(), startGroupChat: vi.fn(), openChat: vi.fn() };
    await render(<CreatePage {...props} />);
    expect(host.querySelector('[aria-label="Getting started"]')).toBeNull();
    expect(host.textContent).not.toContain("Start chatting in a few minutes");
  });
});

describe("dialog focus and background", () => {
  it("contains outside focus and Tab even after all controls become disabled", async () => {
    await render(<div className="nv-root"><button>Background</button><Modal title="Dialog" onClose={() => {}}><button>Last</button></Modal></div>);
    const background = button("Background");
    const dialog = host.querySelector('[role="dialog"]');
    expect(background.hasAttribute("inert")).toBe(true);
    background.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (const control of dialog.querySelectorAll("button")) control.disabled = true;
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
    await render(null);
    expect(document.body.hasAttribute("inert")).toBe(false);
  });

  it("restores parent focus and background inert state after closing nested dialogs", async () => {
    const outside = document.createElement("button"); outside.setAttribute("inert", "existing"); document.body.append(outside);
    function Sheets() {
      const [inner, setInner] = useState(false);
      const [outer, setOuter] = useState(true);
      return <div className="nv-root"><button>Background</button>{outer && <Modal title="Outer" onClose={() => setOuter(false)}>
        <button onClick={() => setInner(true)}>Open inner</button>
        {inner && <Modal title="Inner" onClose={() => setInner(false)}><button>Inside</button></Modal>}
      </Modal>}</div>;
    }
    try {
      await render(<Sheets />);
      const trigger = button("Open inner"); trigger.focus();
      await click(trigger);
      const outer = host.querySelector('[aria-label="Outer"]');
      const inner = host.querySelector('[aria-label="Inner"]');
      expect(outer.closest("[inert]")).not.toBeNull();
      expect(inner.closest("[inert]")).toBeNull();
      button("Background").focus();
      expect(inner.contains(document.activeElement)).toBe(true);
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      expect(host.querySelector('[aria-label="Inner"]')).toBeNull();
      expect(outer.closest("[inert]")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(button("Background").hasAttribute("inert")).toBe(true);
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      expect(button("Background").hasAttribute("inert")).toBe(false);
      expect(outside.getAttribute("inert")).toBe("existing");
    } finally { outside.remove(); }
  });
});
