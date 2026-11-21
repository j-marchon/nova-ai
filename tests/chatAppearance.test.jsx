// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatAppearance } from "../src/components/chatAppearance.js";
import { ThemeSection, ChatChromeMock } from "../src/components/theme.jsx";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { emptyData } from "../src/lib/data.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async ui => { await act(async () => root.render(ui)); };

describe("chat transparency", () => {
  it("zero removes fills and blur without fading text", () => {
    const look = chatAppearance({ bubbleAlpha: 0 }, { hasBackground: true });
    expect([look.userBubbleBg, look.aiBubbleBg, look.composerBg, look.controlBg]).toEqual(Array(4).fill("transparent"));
    expect(look.composerBorder).toBe("transparent");
    expect(look.composerBlur).toBe("none"); expect(look.userBubbleFg).toBe("var(--nv-ink)");
  });
  it("saved opacity applies to all chat surfaces and only still media can blur", () => {
    const still = chatAppearance({ bubbleAlpha: .4 }, { hasBackground: true });
    expect(still.composerBorder).toContain("4%");
    expect(still.composerBg).toContain("40%"); expect(still.userBubbleBg).toContain("40%");
    expect(still.composerBlur).toBe("blur(4.0px)");
    expect(chatAppearance({ bubbleAlpha: .4 }, { hasBackground: true, moving: true }).composerBlur).toBe("none");
    expect(chatAppearance({ bubbleAlpha: .4 }).composerBlur).toBe("none");
  });
  it("normalizes malformed opacity without changing the user's media", () => {
    expect(chatAppearance({ bubbleAlpha: -1 }).alpha).toBe(0);
    expect(chatAppearance({ bubbleAlpha: 2 }).alpha).toBe(1);
    expect(chatAppearance({ bubbleAlpha: "broken" }).alpha).toBe(.8);
  });
  it("the restored slider saves zero and retains backgrounds and legacy colour fields", async () => {
    let saved;
    const background = { image: "data:image/png;base64,AA==", opacity: .7 };
    function Form() {
      const [theme, setTheme] = useState({ bubbleAlpha: .6, userBubble: "#123456", bgs: [background] }); saved = theme;
      return <ThemeSection theme={theme} onChange={setTheme} />;
    }
    await render(<Form />);
    const input = host.querySelector('input[type="range"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => { setter.call(input, "0"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(saved.bubbleAlpha).toBe(0); expect(saved.bgs).toEqual([background]); expect(saved.userBubble).toBe("#123456");
    expect(host.textContent).toContain("Invisible");
  });
  it("the real chat exposes the backdrop through its header, bubbles and composer at zero", async () => {
    const data = structuredClone(emptyData);
    data.characters = [{ id: "c", name: "Aria", description: "", theme: { bubbleAlpha: 0, bgs: [{ image: "data:image/png;base64,AA==", opacity: 1 }] } }];
    data.chats = [{ id: "chat", characterId: "c", kind: "character", messages: [{ id: "m", role: "assistant", content: "A visible reply" }] }];
    await render(<ChatPage data={data} chatId="chat" update={() => {}} goBack={() => {}} goSettings={() => {}} />);
    expect(host.querySelector(".nv-chat-root").style.getPropertyValue("--nv-chat-panel")).toBe("transparent");
    expect(host.querySelector(".nv-chat-root").style.getPropertyValue("--nv-chat-control")).toBe("transparent");
    expect(host.querySelector(".nv-chat-header").style.background).toBe("transparent");
    expect(host.querySelector(".nv-composer").style.background).toBe("transparent");
    expect(host.querySelector(".nv-msg").style.background).toBe("transparent");
    expect(host.textContent).toContain("A visible reply");
    expect(host.querySelector('textarea[placeholder="Message…"]')).not.toBeNull();
  });
  it("the background editor preview respects the same zero-opacity setting", async () => {
    await render(<ChatChromeMock theme={{ bubbleAlpha: 0 }} />);
    expect([...host.querySelectorAll('[style*="background: transparent"]')].length).toBeGreaterThanOrEqual(4);
    expect(host.textContent).toContain("Message…");
  });
  it.each([.4, 1])("keeps the chat header completely transparent at opacity %s and exposes message actions without a trailing button", async alpha => {
    const data = structuredClone(emptyData);
    data.characters = [{ id: "c", name: "Aria", description: "", theme: { bubbleAlpha: alpha } }];
    data.chats = [{ id: "chat", characterId: "c", kind: "character", messages: [{ id: "m", role: "assistant", content: "A visible reply" }] }];
    await render(<ChatPage data={data} chatId="chat" update={() => {}} goBack={() => {}} goSettings={() => {}} />);
    expect(host.querySelector(".nv-chat-header").style.background).toBe("transparent");
    expect(host.querySelector('button[aria-label="Message options"]')).toBeNull();
    expect(host.querySelector(".nv-msg").closest(".max-w-full")).not.toBeNull();
    await act(async () => host.querySelector(".nv-msg").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(document.body.textContent).toContain("Bookmark");
  });

});
