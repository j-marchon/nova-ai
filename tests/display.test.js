// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { displayHtml, displaySource } from "../src/lib/html.js";
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

  it("sanitises: no scripts, handlers, network loads, classes or positioning", () => {
    const html = displayHtml(
      '<img src="https://t.example/p.gif"><script>alert(1)</script><b onclick="x()" class="fixed inset-0" id="a">ok</b>' +
      '<a href="javascript:alert(1)">l</a><a href="https://example.com">m</a><style>body{display:none}</style>' +
      '<div style="background:url(https://t.example/a.png);color:red">c</div><iframe src="https://x"></iframe>BOND: 7',
      rules, "assistant", 0,
    );
    expect(html).not.toMatch(/<img|<script|onclick|class=|id=|javascript:|<style|url\(|<iframe|[ ;"]position:|[ ;"]top:/i);
    expect(html).toContain("<b>ok</b>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/style="[^"]*color: red;"/);
    expect(html).toMatch(/width: 7%/);
  });
});
