#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testRoot = join(projectRoot, "test");
const srcRoot = join(projectRoot, "src");
const coverageRoot = join(projectRoot, "coverage");
const rawCoverageRoot = join(coverageRoot, "v8");
const lcovPath = join(coverageRoot, "lcov.info");

await rm(coverageRoot, { recursive: true, force: true });
await mkdir(rawCoverageRoot, { recursive: true });

const testFiles = await collectFiles(testRoot, ".test.mjs");
const testExitCode = await runTestsWithCoverage(testFiles);
if (testExitCode !== 0) {
  process.exitCode = testExitCode;
} else {
  const sourceFiles = await collectFiles(srcRoot, ".ts");
  const coverageByPath = await readV8CoverageByPath(rawCoverageRoot);
  const lcov = await buildLcovReport(sourceFiles, coverageByPath);

  await writeFile(lcovPath, lcov, "utf8");
  console.log(`Coverage LCOV written to ${relative(projectRoot, lcovPath)}.`);
}

async function collectFiles(root, suffix) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, suffix)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(suffix)) files.push(path);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function runTestsWithCoverage(testFiles) {
  const child = spawn(process.execPath, ["--test", ...testFiles], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_V8_COVERAGE: rawCoverageRoot,
    },
    stdio: "inherit",
  });

  return new Promise((resolveExitCode, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolveExitCode(code ?? 1));
  });
}

async function readV8CoverageByPath(rawCoveragePath) {
  const coverageFiles = await collectFiles(rawCoveragePath, ".json");
  const coverageByPath = new Map();

  for (const coverageFile of coverageFiles) {
    const coverage = JSON.parse(await readFile(coverageFile, "utf8"));
    appendCoverageEntries(coverageByPath, coverage.result ?? []);
  }

  return coverageByPath;
}

function appendCoverageEntries(coverageByPath, coverageEntries) {
  for (const entry of coverageEntries) {
    const filePath = readCoverageFilePath(entry.url);
    if (!filePath || !filePath.startsWith(srcRoot)) continue;

    const existingFunctions = coverageByPath.get(filePath) ?? [];
    coverageByPath.set(filePath, [...existingFunctions, ...(entry.functions ?? [])]);
  }
}

function readCoverageFilePath(url) {
  if (typeof url !== "string" || !url.startsWith("file:")) return null;

  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

async function buildLcovReport(sourceFiles, coverageByPath) {
  const records = [];

  for (const sourceFile of sourceFiles) {
    const sourceText = await readFile(sourceFile, "utf8");
    records.push(buildLcovRecord(sourceFile, sourceText, coverageByPath.get(sourceFile) ?? []));
  }

  return `${records.join("\n")}\n`;
}

function buildLcovRecord(sourceFile, sourceText, functionCoverages) {
  const lineInfos = buildLineInfos(sourceText);
  const dataLines = lineInfos.map((lineInfo) => buildDataLine(lineInfo, functionCoverages));
  const coveredLines = dataLines.filter((line) => line.count > 0).length;
  const relativeSourcePath = relative(projectRoot, sourceFile);

  return [
    "TN:",
    `SF:${relativeSourcePath}`,
    ...dataLines.map((line) => `DA:${line.number},${line.count}`),
    `LF:${dataLines.length}`,
    `LH:${coveredLines}`,
    "end_of_record",
  ].join("\n");
}

function buildLineInfos(sourceText) {
  const lineStarts = buildLineStarts(sourceText);
  const lineInfos = [];

  for (const [index, lineStart] of lineStarts.entries()) {
    const lineEnd = lineStarts[index + 1] ?? sourceText.length;
    const lineText = sourceText.slice(lineStart, lineEnd);
    const codeColumn = lineText.search(/\S/u);
    if (codeColumn === -1) continue;

    lineInfos.push({
      number: index + 1,
      offset: lineStart + codeColumn,
    });
  }

  return lineInfos;
}

function buildLineStarts(sourceText) {
  const starts = [0];

  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n" && index + 1 < sourceText.length) starts.push(index + 1);
  }

  return starts;
}

function buildDataLine(lineInfo, functionCoverages) {
  return {
    number: lineInfo.number,
    count: readLineExecutionCount(lineInfo.offset, functionCoverages),
  };
}

function readLineExecutionCount(offset, functionCoverages) {
  let count = 0;

  for (const functionCoverage of functionCoverages) {
    count += readInnermostRangeCount(offset, functionCoverage.ranges ?? []);
  }

  return count;
}

function readInnermostRangeCount(offset, ranges) {
  const matchingRanges = ranges
    .filter((range) => range.startOffset <= offset && offset < range.endOffset)
    .sort((left, right) => readRangeLength(left) - readRangeLength(right));

  return matchingRanges[0]?.count ?? 0;
}

function readRangeLength(range) {
  return range.endOffset - range.startOffset;
}
