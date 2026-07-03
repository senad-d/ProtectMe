import { EXTENSION_DISPLAY_NAME, EXTENSION_STATUS_KEY } from "../constants.ts";
import type { ProtectMeConfigLoadResult } from "../config/index.ts";

export interface ProtectMeSessionStatusContext {
  hasUI?: boolean;
  ui?: unknown;
}

export interface ProtectMeSessionStatusUI {
  setStatus(key: string, text: string | undefined): void;
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

export function buildProtectMeStatusText(config: ProtectMeConfigLoadResult): string {
  const projectConfigStatus = formatIgnoredProjectConfigStatus(config);

  return `🌐 (${formatSiteCount(config.effective.allowList.length)})${projectConfigStatus}`;
}

export function buildProtectMeConfigWarningMessage(warnings: string[]): string | null {
  if (warnings.length === 0) return null;

  const visibleWarnings = warnings.slice(0, 3);
  const overflow = warnings.length > visibleWarnings.length ? `; +${warnings.length - visibleWarnings.length} more` : "";

  return `${EXTENSION_DISPLAY_NAME} config warning: ${visibleWarnings.join("; ")}${overflow}`;
}

export function syncProtectMeSessionStatus(ui: unknown, config: ProtectMeConfigLoadResult): void {
  const statusUI = readProtectMeSessionStatusUI(ui);
  if (!statusUI) return;

  statusUI.setStatus(EXTENSION_STATUS_KEY, buildProtectMeStatusText(config));
  notifyProtectMeConfigWarnings(statusUI, config);
}

export function syncProtectMeSessionStatusFromContext(
  ctx: ProtectMeSessionStatusContext,
  config: ProtectMeConfigLoadResult,
): void {
  if (ctx.hasUI !== true) return;

  syncProtectMeSessionStatus(ctx.ui, config);
}

export function clearProtectMeSessionStatus(ui: unknown): void {
  const statusUI = readProtectMeSessionStatusUI(ui);
  if (!statusUI) return;

  statusUI.setStatus(EXTENSION_STATUS_KEY, undefined);
}

export function clearProtectMeSessionStatusFromContext(ctx: ProtectMeSessionStatusContext): void {
  if (ctx.hasUI !== true) return;

  clearProtectMeSessionStatus(ctx.ui);
}

function notifyProtectMeConfigWarnings(ui: ProtectMeSessionStatusUI, config: ProtectMeConfigLoadResult): void {
  if (!ui.notify) return;

  const message = buildProtectMeConfigWarningMessage(config.effective.warnings);
  if (message) ui.notify(message, "warning");
}

function readProtectMeSessionStatusUI(value: unknown): ProtectMeSessionStatusUI | null {
  if (!isRecord(value)) return null;
  if (typeof value.setStatus !== "function") return null;

  return value as unknown as ProtectMeSessionStatusUI;
}

function formatSiteCount(count: number): string {
  const label = count === 1 ? "site" : "sites";

  return `${count} ${label}`;
}

function formatIgnoredProjectConfigStatus(config: ProtectMeConfigLoadResult): string {
  if (config.projectConfig.status !== "ignored") return "";

  return " · project config ignored";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
