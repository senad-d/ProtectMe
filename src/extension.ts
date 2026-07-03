import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerProtectMeConfig } from "./config/index.ts";
import { registerNetworkGuardEvents } from "./events/network-guard.ts";
import { registerBlockedAttemptLogging } from "./logging/blocked-attempt-log.ts";
import { registerProtectMePolicy } from "./policy/index.ts";
import { registerProtectMeCommand } from "./ui/protectme-panel.ts";

export default function protectMeExtension(pi: ExtensionAPI) {
  registerProtectMeConfig(pi);
  registerProtectMePolicy(pi);
  registerBlockedAttemptLogging(pi);
  registerNetworkGuardEvents(pi);
  registerProtectMeCommand(pi);
}
