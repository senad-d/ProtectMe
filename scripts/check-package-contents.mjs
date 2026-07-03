#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const hiddenEnvironmentFilePattern = /^\.env(?:$|\.)/;

export const forbiddenPackageContentChecks = [
  { label: "environment files", test: (path) => hiddenEnvironmentFilePattern.test(path) },
  { label: "project-local pi state", test: (path) => path === ".pi" || path.startsWith(".pi/") },
  { label: "node_modules", test: (path) => path.startsWith("node_modules/") || path.includes("/node_modules/") },
  { label: "planning specs", test: (path) => path.startsWith("specs/") || path.includes("/specs/") },
  { label: "ProtectMe runtime logs", test: (path) => /(^|\/)protectme_log\.jsonl$/u.test(path) },
  { label: "local caches", test: (path) => /(^|\/)(\.cache|\.local|\.trivycache)(\/|$)/u.test(path) },
  { label: "generated reports", test: (path) => /(^|\/)(coverage|trivy-reports|odc-reports)(\/|$)/u.test(path) },
  { label: "build outputs", test: (path) => /(^|\/)(dist|build|\.nyc_output)(\/|$)/u.test(path) || path.endsWith(".tsbuildinfo") },
  { label: "npm tarballs", test: (path) => path.endsWith(".tgz") },
  { label: "OS/editor/log files", test: (path) => path.endsWith(".DS_Store") || path.endsWith(".log") },
];

export function readPackageJson() {
  return JSON.parse(readFileSync(packageJsonUrl, "utf8"));
}

export function readPackFiles() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const output = execFileSync(npmCommand, ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output);
  const pack = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!pack || !Array.isArray(pack.files)) {
    throw new Error("Unexpected npm pack --dry-run --json output.");
  }

  return pack.files.map((file) => file.path).sort((a, b) => a.localeCompare(b));
}

export function validatePackageFiles(files, checks = forbiddenPackageContentChecks) {
  const violations = [];

  for (const file of files) {
    for (const check of checks) {
      if (check.test(file)) violations.push({ file, label: check.label });
    }
  }

  return violations;
}

export function printPackageContentsReport(packageName, files) {
  console.log(`${packageName} package dry-run contains ${files.length} file(s).`);
  for (const file of files) console.log(`- ${file}`);
}

export function printPackageContentViolations(violations) {
  if (violations.length === 0) return;

  console.error("\nForbidden package contents detected:");
  for (const violation of violations) console.error(`- ${violation.file} (${violation.label})`);
}

export function runPackageContentCheck() {
  const pkg = readPackageJson();
  const files = readPackFiles();
  const violations = validatePackageFiles(files);

  printPackageContentsReport(pkg.name, files);
  printPackageContentViolations(violations);

  return violations.length === 0 ? 0 : 1;
}

function isMainModule() {
  const entryPath = process.argv[1];
  if (!entryPath) return false;

  return resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isMainModule()) process.exitCode = runPackageContentCheck();
