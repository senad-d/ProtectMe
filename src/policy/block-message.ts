import { EXTENSION_DISPLAY_NAME } from "../constants.ts";

export function buildProtectMeBlockReason(host: string): string {
  return `${EXTENSION_DISPLAY_NAME} blocked network request to ${host}. mode: "block" allows only configured hosts. Do not retry blindly; continue with local or already allowed work, or ask the user if access is required.`;
}

export function buildProtectMeFirstBlockGuidance(host: string): string {
  return `${EXTENSION_DISPLAY_NAME} blocked ${host}. Do not retry blindly. Continue with local or already allowed work, or ask the user if network access is necessary.`;
}

export function buildProtectMePromptUnavailableBlockReason(host: string): string {
  return `${EXTENSION_DISPLAY_NAME} blocked repeated network request to ${host}. Confirmation is unavailable because this session has no UI, so the request failed closed.`;
}

export function buildProtectMePromptDeniedBlockReason(host: string): string {
  return `${EXTENSION_DISPLAY_NAME} kept blocking network request to ${host}. The user did not approve this call.`;
}

export function buildProtectMeConfigWriteFailedBlockReason(host: string, detail: string): string {
  return `${EXTENSION_DISPLAY_NAME} blocked network request to ${host}. The requested config update failed, so confirmation was not saved: ${detail}`;
}
