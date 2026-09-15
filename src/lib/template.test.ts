import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template";

describe("renderTemplate", () => {
  it("fills a simple placeholder", () => {
    expect(renderTemplate("<h1>{{ title }}</h1>", { title: "Report" }).html).toBe(
      "<h1>Report</h1>",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{title}} {{  title  }}", { title: "x" }).html).toBe("x x");
  });

  it("renders numbers", () => {
    expect(renderTemplate("{{ n }}", { n: 42 }).html).toBe("42");
  });

  it("escapes HTML in values", () => {
    const result = renderTemplate("<p>{{ company }}</p>", {
      company: '<script>alert("x")</script>',
    });
    expect(result.html).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  });

  it("escapes quotes so a value cannot break out of a style attribute", () => {
    const result = renderTemplate('<div style="width: {{ w }};"></div>', {
      w: '100%" onload="steal()',
    });
    expect(result.html).not.toContain('onload="steal()"');
    expect(result.html).toContain("&quot;");
  });

  it("expands a loop over rows", () => {
    const template =
      '<sc-for list="{{ items }}" as="i"><li>{{ i.name }}: {{ i.cost }}</li></sc-for>';
    const result = renderTemplate(template, {
      items: [
        { name: "Pipelines", cost: "$1,000" },
        { name: "Modeling", cost: "$2,000" },
      ],
    });
    expect(result.html).toBe("<li>Pipelines: $1,000</li><li>Modeling: $2,000</li>");
  });

  it("ignores extra attributes on the loop tag", () => {
    const template =
      '<sc-for list="{{ items }}" as="i" hint-placeholder-count="6"><b>{{ i.v }}</b></sc-for>';
    expect(renderTemplate(template, { items: [{ v: "a" }] }).html).toBe("<b>a</b>");
  });

  it("renders an empty list as nothing rather than leaving the tag behind", () => {
    const template = '<sc-for list="{{ items }}" as="i"><li>{{ i.v }}</li></sc-for>';
    const result = renderTemplate(template, { items: [] });
    expect(result.html).toBe("");
    expect(result.missing).toEqual([]);
  });

  it("expands two sibling loops independently", () => {
    const template =
      '<sc-for list="{{ a }}" as="x"><i>{{ x.v }}</i></sc-for>|' +
      '<sc-for list="{{ b }}" as="y"><j>{{ y.v }}</j></sc-for>';
    const result = renderTemplate(template, { a: [{ v: "1" }], b: [{ v: "2" }] });
    expect(result.html).toBe("<i>1</i>|<j>2</j>");
  });

  it("escapes values inside loop rows too", () => {
    const template = '<sc-for list="{{ r }}" as="x"><p>{{ x.v }}</p></sc-for>';
    expect(renderTemplate(template, { r: [{ v: "<b>" }] }).html).toBe("<p>&lt;b&gt;</p>");
  });

  it("reports a missing scalar and renders it empty", () => {
    const result = renderTemplate("a{{ nope }}b", {});
    expect(result.html).toBe("ab");
    expect(result.missing).toEqual(["nope"]);
  });

  it("reports a missing row property", () => {
    const template = '<sc-for list="{{ r }}" as="x"><p>{{ x.absent }}</p></sc-for>';
    const result = renderTemplate(template, { r: [{ present: "1" }] });
    expect(result.missing).toEqual(["x.absent"]);
  });

  it("reports a loop whose list is missing, and drops the block", () => {
    const template = 'before<sc-for list="{{ gone }}" as="x">{{ x.v }}</sc-for>after';
    const result = renderTemplate(template, {});
    expect(result.html).toBe("beforeafter");
    expect(result.missing).toEqual(["gone"]);
  });

  it("does not report the same missing key twice", () => {
    expect(renderTemplate("{{ a }}{{ a }}", {}).missing).toEqual(["a"]);
  });

  it("leaves a scalar referenced as a list unresolved rather than rendering junk", () => {
    const result = renderTemplate('<sc-for list="{{ s }}" as="x">{{ x.v }}</sc-for>', {
      s: "not a list",
    });
    expect(result.html).toBe("");
    expect(result.missing).toEqual(["s"]);
  });
});
