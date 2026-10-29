// The reference runtime against the shared parity cases (test/cases/*.json). Other runtimes run the same files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseText, flattenGlossary, computePlacement } from "../frameworks/web/deeptip.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./cases/${name}`, import.meta.url), "utf8")).cases;

for (const c of load("markup.json")) {
  test(`markup: ${c.name}`, () => assert.deepEqual(parseText(c.src), c.blocks));
}
for (const c of load("placement.json")) {
  test(`placement: ${c.name}`, () => assert.deepEqual(computePlacement(c.size, c.anchor, c.sides, c.viewport), c.expect));
}
for (const c of load("glossary.json")) {
  test(`glossary: ${c.name}`, () => {
    const { entries, meta, problems } = flattenGlossary(c.input);
    assert.deepEqual({ keys: [...entries.keys()], meta: Object.keys(meta), problems: problems.length }, c.expect);
  });
}
