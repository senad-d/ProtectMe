import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("package declares the ProtectMe Pi extension entry file", async () => {
  assert.equal(packageJson.name, "@senad-d/protectme");
  assert.deepEqual(packageJson.pi?.extensions, ["./src/extension.ts"]);
  await access(new URL("../src/extension.ts", import.meta.url));
});

test("package metadata no longer exposes template rename instructions", () => {
  assert.equal(packageJson._template, undefined);
  assert.match(packageJson.description, /network|website|guard/i);
  assert.ok(packageJson.keywords.includes("pi-package"));
  assert.ok(packageJson.keywords.includes("pi-extension"));
});

test("preparation specs are present and implementation backlog remains available", async () => {
  const specsUrl = new URL("../specs/", import.meta.url);
  const files = (await readdir(specsUrl)).filter((name) => name.endsWith(".md")).sort();

  assert.deepEqual(files, [
    "spec-protectme-architecture.md",
    "spec-protectme-guidelines.md",
    "spec-protectme-tasks.md",
  ]);

  const taskSpec = await readFile(new URL("../specs/spec-protectme-tasks.md", import.meta.url), "utf8");
  assert.match(taskSpec, /### 1\. Replace preparation placeholder with extension module registrations/);
  assert.match(taskSpec, /- \[ \] /);
});

test("documentation includes implemented config schema and isolated smoke command", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const smokeTest = await readFile(new URL("../docs/manual-smoke-test.md", import.meta.url), "utf8");

  assert.match(readme, /"mode": "block"/);
  assert.match(readme, /"allowList"/);
  assert.match(readme, /pi --no-extensions -e \./);
  assert.match(smokeTest, /pi --no-extensions -e \./);
  assert.match(smokeTest, /\/protectme/);
});
