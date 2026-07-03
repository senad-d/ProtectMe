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
  const requiredSpecs = [
    "spec-protectme-architecture.md",
    "spec-protectme-guidelines.md",
    "spec-protectme-tasks.md",
  ];

  for (const specFile of requiredSpecs) assert.ok(files.includes(specFile), `${specFile} should exist`);
  assert.ok(files.every((name) => name.startsWith("spec-") && name.endsWith(".md")));

  const taskSpec = await readFile(new URL("../specs/spec-protectme-tasks.md", import.meta.url), "utf8");
  assert.match(taskSpec, /### 1\. Replace preparation placeholder with extension module registrations/);
  assert.match(taskSpec, /- \[[ x]\] /);
});

test("Sonar workflow coverage script exists and matches configured LCOV report", async () => {
  const sonarWorkflow = await readFile(new URL("../.github/workflows/sonar.yml", import.meta.url), "utf8");
  const sonarProperties = await readFile(new URL("../sonar-project.properties", import.meta.url), "utf8");
  const sonarScriptNames = extractNpmRunScripts(sonarWorkflow);

  assert.ok(sonarScriptNames.includes("test:coverage"));
  for (const scriptName of sonarScriptNames) {
    assert.equal(typeof packageJson.scripts?.[scriptName], "string", `package.json should define ${scriptName}`);
  }

  assert.match(packageJson.scripts["test:coverage"], /scripts\/run-test-coverage\.mjs/);
  assert.match(sonarProperties, /^sonar\.javascript\.lcov\.reportPaths=coverage\/lcov\.info$/m);
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

function extractNpmRunScripts(workflowText) {
  return [...workflowText.matchAll(/\brun:\s*npm run ([\w:-]+)/gu)].map((match) => match[1]);
}
