// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { displayHtml, displaySource, scopeCss } from "../src/lib/html.js";
import { tavernRegex } from "../src/lib/tavern.js";

const rules = tavernRegex([
  { scriptName: "Color", findRegex: "/<(pink|teal)>([\"“][^\"”]+[\"”])<\\/\\1>/gi", replaceString: "<span style=\"color:$1;\">$2</span>", placement: [2], markdownOnly: true },
  { scriptName: "Bars", findRegex: "/BOND: (\\d+)/g", replaceString: "<div style=\"width:$1%;background:#0f0;position:fixed;top:0\">$1</div>", placement: [2], markdownOnly: true, minDepth: 0, maxDepth: 1 },
  { scriptName: "Prompt only", findRegex: "/x/g", replaceString: "y", placement: [2], promptOnly: true },
  { scriptName: "Off", findRegex: "/a/g", replaceString: "b", placement: [2], markdownOnly: true, disabled: true },
], "display");

describe("display regex", () => {
  it("keeps only enabled display-only scripts", () => {
    expect(rules.map((r) => r.name)).toEqual(["Color", "Bars"]);
  });

  it("colours dialogue and keeps Nova's action styling", () => {
    const html = displayHtml('*She waves.* <pink>"Hi!"</pink>', rules, "assistant", 0);
    expect(html).toBe('<em class="opacity-75">She waves.</em> <span style="color:pink;">"Hi!"</span>');
  });

  it("renders the model's own HTML, without gaps between blocks", () => {
    const html = displayHtml("Text.\n\n<details>\n<summary>BONDS</summary>\n- <b>A</b>\n</details>", rules, "assistant", 0);
    expect(html).toBe("Text.<details><summary>BONDS</summary>- <b>A</b></details>");
  });

  it("only reaches the depths and roles it names", () => {
    expect(displaySource("BOND: 5", rules, "assistant", 3)).toBe("BOND: 5");
    expect(displaySource("BOND: 5", rules, "user", 0)).toBe("BOND: 5");
    expect(displaySource("BOND: 5", rules, "assistant", 1)).toContain("width:5%");
  });

  it("hides notes after the scripts have seen them", () => {
    const anchored = tavernRegex([{ findRegex: "/X(?=<!-- END -->)/g", replaceString: "Y", placement: [2], markdownOnly: true }], "display");
    expect(displaySource("X<!-- END -->", anchored, "assistant", 0)).toBe("Y");
  });

  it("keeps a preset's own styles, classes and icons, fenced in", () => {
    const html = displayHtml(
      "<style>.chip{color:red;position:fixed}.chip:hover .tip{display:block;position:absolute;z-index:9999}body{display:none}@import url(https://x.example/a.css);</style>" +
      "<span class='chip' id='a'>hi<svg width='10' height='10' viewBox='0 0 24 24'><path d='M9 6l6 6'/></svg><span class='tip'>t</span></span>",
      rules, "assistant", 0,
    );
    expect(html).toContain("<style>.nv-pv .pv-chip{color:red}.nv-pv .pv-chip:hover .pv-tip{display:block;position:absolute;z-index:20}</style>");
    expect(html).toContain('class="pv-chip"');
    expect(html).toContain('id="pv-a"');
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/body|@import|fixed/);
  });

  it("limits what a scoped stylesheet can reach", () => {
    expect(scopeCss("@media (max-width:600px){.a{top:0}}@keyframes k{from{opacity:0}to{opacity:1}}@font-face{src:url(x)}")).toBe("@media (max-width:600px){.nv-pv .pv-a{top:0}}@keyframes k{from{opacity:0}to{opacity:1}}");
    expect(scopeCss("html{color:red}:root{--x:1}.a,.b{color:blue}")).toBe(".nv-pv .pv-a,.nv-pv .pv-b{color:blue}");
    expect(scopeCss('.a{background:url("https://x")}')).toBe("");
  });

  it("sanitises: no scripts, handlers, network loads or positioning that escapes the bubble", () => {
    const html = displayHtml(
      '<img src="https://t.example/p.gif"><script>alert(1)</script><b onclick="x()" class="fixed inset-0" id="a">ok</b>' +
      '<a href="javascript:alert(1)">l</a><a href="https://example.com">m</a><style>body{display:none}</style>' +
      '<div style="background:url(https://t.example/a.png);color:red">c</div><iframe src="https://x"></iframe>BOND: 7',
      rules, "assistant", 0,
    );
    expect(html).not.toMatch(/<img|<script|onclick|javascript:|<style|url\(|<iframe|[ ;"]position:/i);
    expect(html).toContain('class="pv-fixed pv-inset-0"');
    expect(html).toContain(">ok</b>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/style="[^"]*color: red;"/);
    expect(html).toMatch(/width: 7%/);
  });
});
