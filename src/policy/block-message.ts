import { EXTENSION_DISPLAY_NAME } from "../constants.ts";

export function buildProtectMeBlockReason(host: string, promptAvailable: boolean): string {
  const prefix = `${EXTENSION_DISPLAY_NAME} blocked network request to ${host}. mode: "block" allows only configured hosts.`;
  if (promptAvailable) {
    return `${prefix} If this host is required, repeat the same request once: ${EXTENSION_DISPLAY_NAME} will then ask the user to allow it or keep it blocked. Otherwise continue with local or already allowed work.`;
  }

  return `${prefix} This session has no UI to ask the user, so repeating the request will not help. Continue with local or already allowed work, or ask the user to add the host to the allow list.`;
}

export function buildProtectMeFirstBlockGuidance(host: string, promptAvailable: boolean): string {
  if (promptAvailable) {
    return `${EXTENSION_DISPLAY_NAME} blocked ${host}. If network access to it is required, repeat the same request once so ${EXTENSION_DISPLAY_NAME} can ask the user. Otherwise continue with local or already allowed work.`;
  }

  return `${EXTENSION_DISPLAY_NAME} blocked ${host}. This session cannot ask the user, so do not retry. Continue with local or already allowed work, or ask the user to add ${host} to the allow list.`;
}

export function buildProtectMeUnsupportedNetworkOptionBlockReason(cli: string, rawTarget: string, detail: string): string {
  return `${EXTENSION_DISPLAY_NAME} blocked ${cli} because ${rawTarget} cannot be inspected safely: ${detail}`;
}

export function buildProtectMePromptUnavailableBlockReason(host: string): string {
  return `${EXTENSION_DISPLAY_NAME} blocked repeated network request to ${host}. Confirmation is unavailable because this session has no UI, so the request failed closed.`;
}

export function buildProtectMePromptErrorBlockReason(host: string): string {
  return `${EXTENSION_DISPLAY_NAME} blocked repeated network request to ${host}. The confirmation prompt failed, so the request failed closed. Update the allow list manually or retry after the UI prompt recovers.`;
}

export function buildProtectMePromptDeniedBlockReason(host: string): string {
  return `${EXTENSION_DISPLAY_NAME} kept blocking network request to ${host}. The user did not approve this call.`;
}

export function buildProtectMeConfigWriteFailedBlockReason(host: string, detail: string): string {
  return `${EXTENSION_DISPLAY_NAME} blocked network request to ${host}. The requested config update failed, so confirmation was not saved: ${detail}`;
}
