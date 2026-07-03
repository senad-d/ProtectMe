import assert from "node:assert/strict";
import test from "node:test";

import {
  extractBashNetworkRequestCandidates,
  extractToolCallNetworkRequestCandidates,
  splitBashCommandSegments,
  tokenizeBashSegment,
} from "../src/policy/index.ts";

test("curl request command produces a URL candidate", () => {
  assert.deepEqual(candidateSummary("curl https://example.com"), [
    {
      cli: "curl",
      rawTarget: "https://example.com",
      host: "example.com",
      segmentIndex: 0,
    },
  ]);
});

test("wget request command produces a URL candidate", () => {
  assert.deepEqual(candidateSummary("wget https://example.com/file"), [
    {
      cli: "wget",
      rawTarget: "https://example.com/file",
      host: "example.com",
      segmentIndex: 0,
    },
  ]);
});

test("httpie request command produces a URL candidate after method", () => {
  assert.deepEqual(candidateSummary("http GET https://api.example.com/v1"), [
    {
      cli: "http",
      rawTarget: "https://api.example.com/v1",
      host: "api.example.com",
      segmentIndex: 0,
    },
  ]);
});

test("https httpie shorthand produces a URL candidate", () => {
  assert.deepEqual(candidateSummary("https POST api.example.com/v1 name=value"), [
    {
      cli: "https",
      rawTarget: "api.example.com/v1",
      host: "api.example.com",
      segmentIndex: 0,
    },
  ]);
});

test("raw URL literals without a supported network CLI are ignored", () => {
  assert.deepEqual(candidateSummary("echo https://example.com"), []);
  assert.deepEqual(candidateSummary("printf '%s' https://example.com"), []);
});

test("file and content tool inputs are never parsed", () => {
  const input = { command: "curl https://example.com", content: "curl https://example.com" };

  assert.deepEqual(extractToolCallNetworkRequestCandidates("write", input), []);
  assert.deepEqual(extractToolCallNetworkRequestCandidates("edit", input), []);
  assert.deepEqual(extractToolCallNetworkRequestCandidates("read", input), []);
  assert.deepEqual(candidateSummaryForTool("bash", input), [
    {
      cli: "curl",
      rawTarget: "https://example.com",
      host: "example.com",
      segmentIndex: 0,
    },
  ]);
});

test("curl and wget flags skip non-URL flag values", () => {
  assert.deepEqual(candidateSummary("curl -H 'Accept: application/json' -o out.json --url https://api.example.com/v1"), [
    {
      cli: "curl",
      rawTarget: "https://api.example.com/v1",
      host: "api.example.com",
      segmentIndex: 0,
    },
  ]);
  assert.deepEqual(candidateSummary("wget --header='Accept: application/json' -O out.html https://example.com/file"), [
    {
      cli: "wget",
      rawTarget: "https://example.com/file",
      host: "example.com",
      segmentIndex: 0,
    },
  ]);
});

test("quoted URLs and shell segments are parsed without executing shell code", () => {
  assert.deepEqual(candidateSummary("echo 'curl https://ignored.example' && curl \"https://Quoted.Example.com/a path\""), [
    {
      cli: "curl",
      rawTarget: "https://Quoted.Example.com/a path",
      host: "quoted.example.com",
      segmentIndex: 1,
    },
  ]);
});

test("multiple command segments and pipes are inspected independently", () => {
  assert.deepEqual(candidateSummary("curl https://one.example; echo https://ignored.example | wget https://two.example/file"), [
    {
      cli: "curl",
      rawTarget: "https://one.example",
      host: "one.example",
      segmentIndex: 0,
    },
    {
      cli: "wget",
      rawTarget: "https://two.example/file",
      host: "two.example",
      segmentIndex: 2,
    },
  ]);
});

test("tokenizer respects quotes and segment splitting respects quoted separators", () => {
  assert.deepEqual(splitBashCommandSegments("echo 'a;b|c' && curl https://example.com"), [
    "echo 'a;b|c'",
    "curl https://example.com",
  ]);
  assert.deepEqual(tokenizeBashSegment("curl -H 'Accept: application/json' \"https://example.com/a b\""), [
    "curl",
    "-H",
    "Accept: application/json",
    "https://example.com/a b",
  ]);
});

function candidateSummary(command) {
  return extractBashNetworkRequestCandidates(command).map(toSummary);
}

function candidateSummaryForTool(toolName, input) {
  return extractToolCallNetworkRequestCandidates(toolName, input).map(toSummary);
}

function toSummary(candidate) {
  return {
    cli: candidate.cli,
    rawTarget: candidate.rawTarget,
    host: candidate.host,
    segmentIndex: candidate.segmentIndex,
  };
}
