import assert from "node:assert/strict";
import test from "node:test";

import { validatePackageFiles } from "../scripts/check-package-contents.mjs";

test("package content validation rejects specs, logs, generated artifacts, and local state", () => {
  const violations = validatePackageFiles([
    "README.md",
    "src/extension.ts",
    ".pi/protectme.json",
    ".pi/agent/protectme_log.jsonl",
    "specs/spec-protectme-tasks.md",
    "coverage/lcov.info",
    "trivy-reports/report.json",
    "dist/index.js",
    "protectme-0.1.0.tgz",
    "npm-debug.log",
  ]);

  assert.deepEqual(
    violations.map((violation) => violation.label),
    [
      "project-local pi state",
      "project-local pi state",
      "ProtectMe runtime logs",
      "planning specs",
      "generated reports",
      "generated reports",
      "build outputs",
      "npm tarballs",
      "OS/editor/log files",
    ],
  );
});

test("package content validation allows intended published documentation and source files", () => {
  const violations = validatePackageFiles([
    "README.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "docs/manual-smoke-test.md",
    "src/config/config-loader.ts",
    "src/ui/protectme-panel.ts",
    "tsconfig.json",
  ]);

  assert.deepEqual(violations, []);
});
