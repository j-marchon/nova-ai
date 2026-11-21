// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, rememberData } from "../src/components/ErrorBoundary.jsx";
import { emptyData } from "../src/lib/data.js";
import { readBackup } from "../src/lib/backup.js";
import { saveFile } from "../src/lib/cards.js";

vi.mock("../src/lib/cards.js", async original => ({ ...await original(), saveFile: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
const Boom = () => { throw new Error("render failed"); };

beforeEach(() => {
  saveFile.mockReset().mockImplementation(async (name, parts) => { [...parts]; return `Downloads/${name}`; });
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("root error boundary", () => {
  it("shows a plain screen instead of a blank page, and logs the error", async () => {
    await act(async () => root.render(<ErrorBoundary getData={() => null}><Boom /></ErrorBoundary>));
    expect(host.textContent).toContain("Something went wrong");
    expect([...host.querySelectorAll("button")].map(b => b.textContent)).toEqual(["Reload"]);
    expect(host.querySelector(".nv-root[data-theme]")).not.toBeNull();
    expect(console.error).toHaveBeenCalledWith("Nova stopped rendering", expect.any(Error), expect.anything());
  });

  it("saves a streamed backup of the last known data", async () => {
    const data = structuredClone(emptyData);
    data.username = "Last known";
    rememberData(data);
    await act(async () => root.render(<ErrorBoundary><Boom /></ErrorBoundary>));
    let parts;
    saveFile.mockImplementation(async (name, p) => { parts = [...p]; return `Downloads/${name}`; });
    const save = [...host.querySelectorAll("button")].find(b => b.textContent === "Save a backup");
    await act(async () => { save.click(); });
    expect(readBackup(parts.join("")).state.username).toBe("Last known");
    expect(host.textContent).toContain("Backup saved to Downloads/");
  });
});
