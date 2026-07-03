import assert from "node:assert/strict";
import test from "node:test";

import { isHostAllowed, matchAllowedHost, normalizeAllowListEntries, normalizeHostInput } from "../src/policy/index.ts";

test("host normalization strips URL syntax, ports, case, paths, and trailing dots", () => {
  assert.deepEqual(hostSummary(" HTTPS://Example.COM:443/path?q=1#section "), {
    host: "example.com",
    kind: "dns",
    warnings: [],
  });
  assert.deepEqual(hostSummary("Example.com."), {
    host: "example.com",
    kind: "dns",
    warnings: [],
  });
  assert.deepEqual(hostSummary("localhost:3000/status"), {
    host: "localhost",
    kind: "localhost",
    warnings: [],
  });
});

test("host normalization supports IPv4 and IPv6 hosts", () => {
  assert.deepEqual(hostSummary("127.0.0.1:8080/api"), {
    host: "127.0.0.1",
    kind: "ip",
    warnings: [],
  });
  assert.deepEqual(hostSummary("https://[2001:db8::1]:443/api"), {
    host: "2001:db8::1",
    kind: "ip",
    warnings: [],
  });
  assert.deepEqual(hostSummary("[2001:db8::2]:8443/api"), {
    host: "2001:db8::2",
    kind: "ip",
    warnings: [],
  });
});

test("invalid host entries are ignored with warning metadata", () => {
  const normalized = normalizeAllowListEntries(["example.com", "bad host", "https:///", "EXAMPLE.com."]);

  assert.deepEqual(normalized.entries, ["example.com"]);
  assert.equal(normalized.warnings.length, 2);
  assert.deepEqual(
    normalized.warnings.map((warning) => [warning.input, warning.reason]),
    [
      ["bad host", "invalid_host"],
      ["https:///", "parse_failed"],
    ],
  );
});

test("apex allow entries match themselves, paths, and child subdomains", () => {
  const allowList = ["example.com"];

  assert.equal(isHostAllowed("example.com", allowList), true);
  assert.equal(isHostAllowed("example.com/login", allowList), true);
  assert.equal(isHostAllowed("api.example.com", allowList), true);
  assert.equal(isHostAllowed("v2.api.example.com", allowList), true);
  assert.equal(isHostAllowed("badexample.com", allowList), false);
});

test("child allow entries never allow parent domains", () => {
  const allowList = ["api.example2.com"];

  assert.equal(isHostAllowed("api.example2.com", allowList), true);
  assert.equal(isHostAllowed("v2.api.example2.com", allowList), true);
  assert.equal(isHostAllowed("example2.com", allowList), false);
  assert.equal(isHostAllowed("other.example2.com", allowList), false);
});

test("localhost and IP allow entries match exactly", () => {
  assert.equal(isHostAllowed("localhost", ["localhost"]), true);
  assert.equal(isHostAllowed("localhost:3000/path", ["localhost"]), true);
  assert.equal(isHostAllowed("api.localhost", ["localhost"]), false);
  assert.equal(isHostAllowed("127.0.0.1", ["127.0.0.1"]), true);
  assert.equal(isHostAllowed("127.0.0.2", ["127.0.0.1"]), false);
  assert.equal(isHostAllowed("https://[2001:db8::1]/v1", ["[2001:db8::1]"]), true);
  assert.equal(isHostAllowed("2001:db8::2", ["2001:db8::1"]), false);
});

test("match results expose normalized host, matched entry, and warnings", () => {
  const result = matchAllowedHost("https://API.Example.com:443/v1", ["bad host", "example.com"]);

  assert.equal(result.allowed, true);
  assert.equal(result.host, "api.example.com");
  assert.equal(result.matchedEntry, "example.com");
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.input, "bad host");
});

function hostSummary(input) {
  const result = normalizeHostInput(input);

  return {
    host: result.host,
    kind: result.kind,
    warnings: result.warnings,
  };
}
