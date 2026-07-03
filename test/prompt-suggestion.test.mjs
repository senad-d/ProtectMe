import assert from "node:assert/strict";
import test from "node:test";

import { suggestCleanAllowListEntry } from "../src/policy/index.ts";

test("blocked URL suggests registrable base domain when available", () => {
  const suggestion = suggestCleanAllowListEntry("https://api.example.com/v1?q=1");

  assert.equal(suggestion.blockedHost, "api.example.com");
  assert.equal(suggestion.suggestedEntry, "example.com");
  assert.equal(suggestion.source, "registrable_domain");
  assert.equal(suggestion.editable, true);
});

test("blocked child host suggestion remains editable for user changes", () => {
  const suggestion = suggestCleanAllowListEntry("api.example2.com");

  assert.equal(suggestion.blockedHost, "api.example2.com");
  assert.equal(suggestion.suggestedEntry, "example2.com");
  assert.equal(suggestion.source, "registrable_domain");
  assert.equal(suggestion.editable, true);
});

test("prompt suggestion never includes scheme, path, query, fragment, or port", () => {
  const suggestion = suggestCleanAllowListEntry("HTTPS://V2.API.Example.co.uk:8443/path?q=1#fragment");

  assert.equal(suggestion.blockedHost, "v2.api.example.co.uk");
  assert.equal(suggestion.suggestedEntry, "example.co.uk");
  assert.doesNotMatch(suggestion.suggestedEntry ?? "", /[:/?#]/u);
});

test("localhost, IPs, and single-label hosts fall back to exact normalized host", () => {
  assert.deepEqual(summary("localhost:3000/path"), {
    blockedHost: "localhost",
    suggestedEntry: "localhost",
    source: "exact_host",
    editable: true,
  });
  assert.deepEqual(summary("127.0.0.1:8080/api"), {
    blockedHost: "127.0.0.1",
    suggestedEntry: "127.0.0.1",
    source: "exact_host",
    editable: true,
  });
  assert.deepEqual(summary("https://[2001:db8::1]:443/api"), {
    blockedHost: "2001:db8::1",
    suggestedEntry: "2001:db8::1",
    source: "exact_host",
    editable: true,
  });
  assert.deepEqual(summary("internal-service:8080/api"), {
    blockedHost: "internal-service",
    suggestedEntry: "internal-service",
    source: "exact_host",
    editable: true,
  });
});

test("invalid prompt suggestion input returns warning metadata", () => {
  const suggestion = suggestCleanAllowListEntry("bad host");

  assert.equal(suggestion.blockedHost, null);
  assert.equal(suggestion.suggestedEntry, null);
  assert.equal(suggestion.source, "invalid");
  assert.equal(suggestion.editable, false);
  assert.equal(suggestion.warnings.length, 1);
  assert.equal(suggestion.warnings[0]?.reason, "invalid_host");
});

function summary(input) {
  const suggestion = suggestCleanAllowListEntry(input);

  return {
    blockedHost: suggestion.blockedHost,
    suggestedEntry: suggestion.suggestedEntry,
    source: suggestion.source,
    editable: suggestion.editable,
  };
}
