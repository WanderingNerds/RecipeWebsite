import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HELP_FEEDBACK_CATEGORIES, HELP_FEEDBACK_LIMITS } from "../utils/helpFeedbackUtils.js";

const view = fileURLToPath(new URL("../../views/help-feedback.ejs", import.meta.url));
const stylesheet = fileURLToPath(new URL("../../public/css/styles.css", import.meta.url));
const render = (overrides = {}) => ejs.renderFile(view, {
  csrfToken: "csrf-test",
  categories: HELP_FEEDBACK_CATEGORIES,
  limits: HELP_FEEDBACK_LIMITS,
  values: { category: "Feedback", subject: "Subject", message: "Message", contactName: "Test Cook", contactEmail: "cook@example.com" },
  validationErrors: {},
  submissionError: "",
  ...overrides,
});

test("help feedback form has its required semantic and administrator-review contract", async () => {
  const html = await render();
  assert.match(html, /<form[^>]+action="\/help-feedback"[^>]+method="POST"/);
  assert.match(html, /name="_csrf" value="csrf-test"/);
  assert.match(html, /administrator will review your submission/i);
  assert.match(html, /not automatically acted upon/i);
  for (const [id, type] of [["category", "select"], ["subject", "input"], ["message", "textarea"], ["contactName", "input"], ["contactEmail", "input"]]) {
    assert.match(html, new RegExp(`<label for="${id}">`));
    assert.match(html, new RegExp(`<${type}[^>]+id="${id}"[^>]+required`));
  }
  assert.match(html, /id="contactEmail"[^>]+type="email"/);
  assert.equal((html.match(/<option value="(?:Question|Issue report|Feedback|Help request|Other)"/g) || []).length, 5);
});

test("help feedback form escapes preserved values and associates field errors", async () => {
  const html = await render({
    values: { category: "", subject: "<script>alert(1)</script>", message: "<b>unsafe</b>", contactName: "Cook", contactEmail: "bad" },
    validationErrors: { subject: "Subject is invalid.", contactEmail: "Enter a valid email address." },
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /id="subject"[^>]+aria-invalid="true" aria-describedby="subject-error"/);
  assert.match(html, /id="subject-error">Subject is invalid/);
  assert.match(html, /role="alert"/);
});

test("help feedback styles use defined spacing tokens for card inset and separation", async () => {
  const css = await readFile(stylesheet, "utf8");
  const helpFeedbackCss = css.match(/\/\* REW-70:[\s\S]*?(?=\/\* [═])/u)?.[0] || "";
  const definedProperties = new Set(
    [...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
  );
  const referencedProperties = [...helpFeedbackCss.matchAll(/var\((--[\w-]+)/g)]
    .map((match) => match[1]);
  const separationRule = helpFeedbackCss.match(
    /\.help-feedback__header,\s*\.help-feedback__notice\s*\{([^}]*)\}/,
  )?.[1] || "";
  const insetRule = helpFeedbackCss.match(
    /\.help-feedback__notice,\s*\.help-feedback__form\s*\{([^}]*)\}/,
  )?.[1] || "";
  const noticeParagraphRule = helpFeedbackCss.match(
    /\.help-feedback__notice p:last-child\s*\{([^}]*)\}/,
  )?.[1] || "";

  assert.notEqual(helpFeedbackCss, "", "Help & Feedback CSS section should exist");
  assert.match(separationRule, /margin-bottom:\s*var\(--space-6\)\s*;/);
  assert.match(insetRule, /padding:\s*var\(--space-6\)\s*;/);
  assert.match(noticeParagraphRule, /margin-bottom:\s*0\s*;/);
  assert.deepEqual(
    referencedProperties.filter((property) => !definedProperties.has(property)),
    [],
    "Help & Feedback CSS must not reference undefined custom properties",
  );
});
