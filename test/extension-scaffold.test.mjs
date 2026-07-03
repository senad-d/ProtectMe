import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const extensionUrl = new URL("../src/extension.ts", import.meta.url);
const moduleRegistrations = [
  ["../src/config/index.ts", "registerProtectMeConfig"],
  ["../src/policy/index.ts", "registerProtectMePolicy"],
  ["../src/logging/blocked-attempt-log.ts", "registerBlockedAttemptLogging"],
  ["../src/events/network-guard.ts", "registerNetworkGuardEvents"],
  ["../src/ui/protectme-panel.ts", "registerProtectMeCommand"],
];
const placeholderRegistrations = moduleRegistrations.filter(
  ([, exportName]) => exportName !== "registerNetworkGuardEvents" && exportName !== "registerProtectMeCommand",
);

const directRuntimeRegistrationPattern = /(?:\bregisterCommand\b|\bregisterShortcut\b|\bregisterTool\b|\.on\s*\()/;

test("extension entry point composes ProtectMe module registration shells only", async () => {
  const source = await readFile(extensionUrl, "utf8");
  const expectedCalls = moduleRegistrations.map(([, exportName]) => exportName);
  const calls = [...source.matchAll(/^\s+(register[A-Za-z0-9]+)\(pi\);$/gm)].map((match) => match[1]);

  assert.match(source, /export default function protectMeExtension\(pi: ExtensionAPI\)/);
  assert.deepEqual(calls, expectedCalls);
  assert.doesNotMatch(source, directRuntimeRegistrationPattern);
});

test("ProtectMe module registrations remain discoverable", async () => {
  for (const [relativePath, exportName] of moduleRegistrations) {
    const moduleUrl = new URL(relativePath, import.meta.url);
    await access(moduleUrl);

    const source = await readFile(moduleUrl, "utf8");
    assert.match(source, new RegExp(`export function ${exportName}\\(`));
  }
});

test("placeholder registrations still avoid runtime behavior", async () => {
  for (const [relativePath] of placeholderRegistrations) {
    const moduleUrl = new URL(relativePath, import.meta.url);
    const source = await readFile(moduleUrl, "utf8");

    assert.doesNotMatch(source, directRuntimeRegistrationPattern);
  }
});
