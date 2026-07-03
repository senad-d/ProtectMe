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

test("supported request CLIs are detected through approved non-network wrappers", () => {
  const cases = [
    ["sudo -u root curl https://sudo.example.com", "sudo.example.com"],
    ["env TOKEN=1 curl https://env.example.com", "env.example.com"],
    ["time curl https://time.example.com", "time.example.com"],
    ["timeout 5 curl https://timeout.example.com", "timeout.example.com"],
    ["nice -n 5 curl https://nice.example.com", "nice.example.com"],
    ["sudo -E env TOKEN=1 timeout --foreground 5 nice -n 1 curl https://stacked.example.com", "stacked.example.com"],
  ];

  for (const [command, host] of cases) {
    assert.deepEqual(candidateSummary(command), [
      {
        cli: "curl",
        rawTarget: `https://${host}`,
        host,
        segmentIndex: 0,
      },
    ]);
  }
});

test("network-affecting option values produce guarded candidates", () => {
  assert.deepEqual(candidateSummary("curl --proxy http://proxy.example.com:8080 https://target.example.com"), [
    {
      cli: "curl",
      rawTarget: "http://proxy.example.com:8080",
      host: "proxy.example.com",
      segmentIndex: 0,
    },
    {
      cli: "curl",
      rawTarget: "https://target.example.com",
      host: "target.example.com",
      segmentIndex: 0,
    },
  ]);
  assert.deepEqual(candidateSummary("curl --resolve api.example.com:443:203.0.113.10 https://api.example.com"), [
    {
      cli: "curl",
      rawTarget: "api.example.com",
      host: "api.example.com",
      segmentIndex: 0,
    },
    {
      cli: "curl",
      rawTarget: "203.0.113.10",
      host: "203.0.113.10",
      segmentIndex: 0,
    },
    {
      cli: "curl",
      rawTarget: "https://api.example.com",
      host: "api.example.com",
      segmentIndex: 0,
    },
  ]);
  assert.deepEqual(candidateSummary("http --proxy=http:http://proxy.example.com GET https://api.example.com"), [
    {
      cli: "http",
      rawTarget: "http://proxy.example.com",
      host: "proxy.example.com",
      segmentIndex: 0,
    },
    {
      cli: "http",
      rawTarget: "https://api.example.com",
      host: "api.example.com",
      segmentIndex: 0,
    },
  ]);
  assert.deepEqual(candidateSummary("wget -e http_proxy=http://proxy.example.com https://target.example.com"), [
    {
      cli: "wget",
      rawTarget: "http://proxy.example.com",
      host: "proxy.example.com",
      segmentIndex: 0,
    },
    {
      cli: "wget",
      rawTarget: "https://target.example.com",
      host: "target.example.com",
      segmentIndex: 0,
    },
  ]);
});

test("static config and input-file option sources fail closed as unsupported candidates", () => {
  assert.deepEqual(candidateSummary("curl --config .curlrc https://allowed.example.com"), [
    {
      cli: "curl",
      rawTarget: "--config .curlrc",
      host: "unsupported static network option",
      segmentIndex: 0,
      unsupportedReason: "curl config files can contain additional URLs or network options that ProtectMe cannot inspect safely.",
    },
    {
      cli: "curl",
      rawTarget: "https://allowed.example.com",
      host: "allowed.example.com",
      segmentIndex: 0,
    },
  ]);
  assert.deepEqual(candidateSummary("wget --input-file urls.txt"), [
    {
      cli: "wget",
      rawTarget: "--input-file urls.txt",
      host: "unsupported static network option",
      segmentIndex: 0,
      unsupportedReason: "wget input files can contain additional URLs that ProtectMe cannot inspect safely.",
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
  const summary = {
    cli: candidate.cli,
    rawTarget: candidate.rawTarget,
    host: candidate.host,
    segmentIndex: candidate.segmentIndex,
  };

  if (candidate.unsupportedReason) summary.unsupportedReason = candidate.unsupportedReason;

  return summary;
}
