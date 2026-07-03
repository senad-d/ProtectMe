import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { normalizeConfigAllowList, type ProtectMeConfigLoadResult } from "../../config/index.ts";
import { EXTENSION_DISPLAY_NAME } from "../../constants.ts";
import type {
  ProtectMePanelDialog,
  ProtectMePanelDialogOption,
  ProtectMePanelSetting,
  ProtectMePanelState,
  ProtectMePanelStatusMessage,
  ProtectMePanelTheme,
  ProtectMePanelWriteTarget,
  SettingValueKind,
} from "./types.ts";

const TINY_MODE_MAX_WIDTH = 23;
const PANEL_TITLE = EXTENSION_DISPLAY_NAME;
const PANEL_SCOPE = "Config";
const BODY_MIN_HEIGHT = 8;
const ROW_INDENT = "  ";
const CURSOR = "▌";

export function renderProtectMePanel(
  width: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  const safeWidth = Math.max(1, width);
  const lines = renderProtectMePanelFresh(safeWidth, state, selectedSettingIndex, writeTarget, statusMessage, theme);

  return lines.map((line) => fitLine(line, safeWidth));
}

export function renderProtectMePanelDialog(
  width: number,
  state: ProtectMePanelState,
  dialog: ProtectMePanelDialog,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  const safeWidth = Math.max(1, width);
  const lines = renderProtectMePanelDialogFresh(safeWidth, state, dialog, statusMessage, theme);

  return lines.map((line) => fitLine(line, safeWidth));
}

export function buildProtectMePanelSettings(
  state: ProtectMePanelState,
  writeTarget: ProtectMePanelWriteTarget,
): ProtectMePanelSetting[] {
  const config = state.config;

  return [
    {
      label: "Effective mode",
      value: config.effective.mode,
      description: `Enter toggles ${writeTarget} mode between block and allow.`,
      kind: "mode",
      action: "toggleMode",
    },
    {
      label: "Edit allow-list entry",
      value: "",
      description: `Enter opens an editable ${writeTarget} allow-list entry flow.`,
      kind: "action",
      action: "addEntry",
    },
    {
      label: "Recent blocked hosts",
      value: "",
      description: "Enter opens the blocked-host log list.",
      kind: "action",
      action: "showRecentBlockedHosts",
    },
  ];
}

export function buildProtectMePanelInfoSettings(state: ProtectMePanelState): ProtectMePanelSetting[] {
  const config = state.config;

  return [
    {
      label: "Global site count",
      value: String(countConfigSites(config.globalConfig.config?.allowList)),
      description: "Normalized allow-list entry count from global config.",
      kind: "count",
    },
    {
      label: "Project site count",
      value: String(countConfigSites(config.projectConfig.config?.allowList)),
      description: "Normalized allow-list entry count from project config.",
      kind: "count",
    },
  ];
}

export function fitLine(value: string, width: number, ellipsis = "…"): string {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) return "";

  const clipped = truncateToWidth(value, safeWidth, ellipsis);
  const padding = Math.max(0, safeWidth - visibleWidth(clipped));

  return `${clipped}${" ".repeat(padding)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function renderProtectMePanelFresh(
  width: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  if (width <= TINY_MODE_MAX_WIDTH) return renderTinyPanel(width, state, theme);

  return renderMainPanel(width, state, selectedSettingIndex, writeTarget, statusMessage, theme);
}

function renderProtectMePanelDialogFresh(
  width: number,
  state: ProtectMePanelState,
  dialog: ProtectMePanelDialog,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  if (width <= TINY_MODE_MAX_WIDTH) return renderTinyDialog(width, dialog, theme);

  return renderDialogPanel(width, state, dialog, statusMessage, theme);
}

function renderMainPanel(
  width: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  const innerWidth = width - 2;
  const rows = renderMainRows(innerWidth, state, selectedSettingIndex, writeTarget, theme);
  const bodyHeight = Math.max(rows.length, BODY_MIN_HEIGHT);
  const lines = renderPanelHeader(width, state, theme);

  for (let index = 0; index < bodyHeight; index += 1) lines.push(renderFrameLine(width, rows[index] ?? "", theme));

  lines.push(renderSeparator(width, theme));
  lines.push(renderFrameLine(width, buildFooterText(state, selectedSettingIndex, writeTarget, statusMessage, theme), theme));
  lines.push(renderBottomBorder(width, theme));

  return lines;
}

function renderDialogPanel(
  width: number,
  state: ProtectMePanelState,
  dialog: ProtectMePanelDialog,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  const innerWidth = width - 2;
  const rows = renderDialogRows(innerWidth, dialog, theme);
  const bodyHeight = Math.max(rows.length, BODY_MIN_HEIGHT);
  const lines = renderPanelHeader(width, state, theme);

  for (let index = 0; index < bodyHeight; index += 1) lines.push(renderFrameLine(width, rows[index] ?? "", theme));

  lines.push(renderSeparator(width, theme));
  lines.push(renderFrameLine(width, buildDialogFooter(dialog, statusMessage, theme), theme));
  lines.push(renderBottomBorder(width, theme));

  return lines;
}

function renderPanelHeader(width: number, state: ProtectMePanelState, theme: ProtectMePanelTheme): string[] {
  return [
    renderTopBorder(width, PANEL_TITLE, PANEL_SCOPE, theme),
    renderFrameLine(width, buildSourceLine(state), theme),
    renderFrameLine(width, `${ROW_INDENT}↑↓ move • Enter action • q quit`, theme),
    renderSeparator(width, theme),
  ];
}

function renderMainRows(
  innerWidth: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  theme: ProtectMePanelTheme,
): string[] {
  const settings = buildProtectMePanelSettings(state, writeTarget);
  const infoSettings = buildProtectMePanelInfoSettings(state);
  const safeSelectedIndex = clamp(selectedSettingIndex, 0, Math.max(0, settings.length - 1));
  const rows = [renderSectionHeader(innerWidth, "Configuration", theme)];

  for (let index = 0; index < settings.length; index += 1) {
    rows.push(renderSettingRow(innerWidth, settings[index]!, index === safeSelectedIndex, theme));
  }

  rows.push("");
  rows.push(renderSectionHeader(innerWidth, "Info", theme));
  for (const setting of infoSettings) rows.push(renderSettingRow(innerWidth, setting, false, theme));

  return rows;
}

function renderDialogRows(innerWidth: number, dialog: ProtectMePanelDialog, theme: ProtectMePanelTheme): string[] {
  const rows = [renderSectionHeader(innerWidth, dialog.title, theme)];

  for (const line of dialog.lines) rows.push(renderDialogTextRow(innerWidth, line, theme));
  if (dialog.input !== undefined) rows.push(renderInputRow(innerWidth, dialog.inputLabel ?? "Entry", dialog.input, theme));
  if (dialog.options) rows.push(...renderDialogOptionRows(innerWidth, dialog.options, dialog.selectedOptionIndex ?? 0, theme));

  return rows;
}

function renderTinyPanel(width: number, state: ProtectMePanelState, theme: ProtectMePanelTheme): string[] {
  const config = state.config;

  return [
    fitLine(theme.fg("accent", EXTENSION_DISPLAY_NAME), width),
    fitLine(`mode ${config.effective.mode}`, width),
    fitLine(`sites ${config.effective.allowList.length}`, width),
    fitLine("q quit", width),
  ];
}

function renderTinyDialog(width: number, dialog: ProtectMePanelDialog, theme: ProtectMePanelTheme): string[] {
  const input = dialog.input === undefined ? "" : `: ${dialog.input}`;

  return [
    fitLine(theme.fg("accent", dialog.title), width),
    fitLine(`${dialog.lines[0] ?? ""}${input}`, width),
    fitLine(dialog.options?.[dialog.selectedOptionIndex ?? 0]?.label ?? "Enter", width),
    fitLine("esc cancel", width),
  ];
}

function countConfigSites(allowList: string[] | undefined): number {
  if (!allowList) return 0;

  return normalizeConfigAllowList(allowList).length;
}

function renderSectionHeader(innerWidth: number, title: string, theme: ProtectMePanelTheme): string {
  return fitLine(`${ROW_INDENT}${theme.fg("accent", theme.bold(title.toUpperCase()))}`, innerWidth);
}

function renderSettingRow(
  innerWidth: number,
  setting: ProtectMePanelSetting,
  selected: boolean,
  theme: ProtectMePanelTheme,
): string {
  const cellWidth = Math.max(0, innerWidth - visibleWidth(ROW_INDENT));
  const valueWidth = setting.value ? Math.max(0, Math.min(28, Math.floor(cellWidth * 0.4))) : 0;
  const labelWidth = Math.max(1, cellWidth - 2 - (valueWidth > 0 ? 1 : 0) - valueWidth);
  const prefix = selected ? theme.fg("accent", "▶ ") : "  ";
  const label = styleSettingLabel(fitLine(setting.label, labelWidth), selected, theme);
  const value = styleSettingValue(fitValue(setting.value, valueWidth, setting.kind), setting, theme);
  const labelPadding = " ".repeat(Math.max(0, labelWidth - visibleWidth(label)));
  const valuePadding = " ".repeat(Math.max(0, valueWidth - visibleWidth(value)));
  const separator = valueWidth > 0 ? " " : "";

  return fitLine(`${ROW_INDENT}${prefix}${label}${labelPadding}${separator}${valuePadding}${value}`, innerWidth);
}

function renderDialogTextRow(innerWidth: number, line: string, theme: ProtectMePanelTheme): string {
  return fitLine(`${ROW_INDENT}${theme.fg("muted", sanitizeCellText(line))}`, innerWidth);
}

function renderInputRow(innerWidth: number, label: string, value: string, theme: ProtectMePanelTheme): string {
  const cellWidth = Math.max(0, innerWidth - visibleWidth(ROW_INDENT));
  const safeLabel = sanitizeCellText(label);
  const labelPrefix = `${safeLabel}: `;
  const inputWidth = Math.max(1, cellWidth - visibleWidth(labelPrefix));
  const styledInput = `${fitLine(sanitizeCellText(value), Math.max(1, inputWidth - 1), "")}${theme.fg("accent", CURSOR)}`;

  return fitLine(`${ROW_INDENT}${labelPrefix}${styledInput}`, innerWidth);
}

function renderDialogOptionRows(
  innerWidth: number,
  options: ProtectMePanelDialogOption[],
  selectedOptionIndex: number,
  theme: ProtectMePanelTheme,
): string[] {
  const safeSelectedIndex = clamp(selectedOptionIndex, 0, Math.max(0, options.length - 1));

  return options.map((option, index) => renderDialogOptionRow(innerWidth, option, index === safeSelectedIndex, theme));
}

function renderDialogOptionRow(
  innerWidth: number,
  option: ProtectMePanelDialogOption,
  selected: boolean,
  theme: ProtectMePanelTheme,
): string {
  const cellWidth = Math.max(0, innerWidth - visibleWidth(ROW_INDENT));
  const prefix = selected ? theme.fg("accent", "▶ ") : "  ";
  const label = selected ? theme.fg("accent", theme.bold(option.label)) : option.label;

  return fitLine(`${ROW_INDENT}${prefix}${fitLine(label, Math.max(1, cellWidth - 2))}`, innerWidth);
}

function styleSettingLabel(label: string, selected: boolean, theme: ProtectMePanelTheme): string {
  if (!selected) return label;

  return theme.fg("accent", theme.bold(label));
}

function styleSettingValue(value: string, setting: ProtectMePanelSetting, theme: ProtectMePanelTheme): string {
  if (setting.kind === "mode" && value === "allow") return theme.fg("success", value);
  if (setting.kind === "mode" && value === "block") return theme.fg("warning", value);
  if (setting.kind === "target") return theme.fg("accent", value);
  if (setting.kind === "action") return theme.fg("muted", value);
  if (value === "none") return theme.fg("dim", value);

  return value;
}

function buildFooterText(
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string {
  const settings = buildProtectMePanelSettings(state, writeTarget);
  const selectedSetting = settings[clamp(selectedSettingIndex, 0, Math.max(0, settings.length - 1))];
  const footer = selectedSetting?.description ?? "Current ProtectMe configuration state.";

  return formatFooterWithStatus(footer, statusMessage, theme);
}

function buildDialogFooter(
  dialog: ProtectMePanelDialog,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string {
  return formatFooterWithStatus(dialog.footer, statusMessage, theme);
}

function formatFooterWithStatus(
  footer: string,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string {
  if (!statusMessage) return `${ROW_INDENT}${footer}`;

  return `${ROW_INDENT}${styleStatusMessage(statusMessage, theme)} • ${footer}`;
}

function styleStatusMessage(statusMessage: ProtectMePanelStatusMessage, theme: ProtectMePanelTheme): string {
  if (statusMessage.type === "error") return theme.fg("warning", statusMessage.text);

  return theme.fg("muted", statusMessage.text);
}

function buildSourceLine(state: ProtectMePanelState): string {
  const configPath = formatGlobalConfigPath(state.config);
  const projectPath = formatProjectTrustPath(state.config);
  const projectStatus = formatIgnoredProjectConfigStatus(state.config);

  return `${ROW_INDENT}Config path ${configPath} • Pi project trust path ${projectPath}${projectStatus}`;
}

function formatGlobalConfigPath(config: ProtectMeConfigLoadResult): string {
  const path = config.paths.globalConfigPath;
  const homeDir = config.paths.homeDir;
  if (homeDir && path.startsWith(`${homeDir}/`)) return `~/${path.slice(homeDir.length + 1)}`;
  if (path.endsWith("/.pi/agent/protectme.json")) return "~/.pi/agent/protectme.json";

  return path;
}

function formatProjectTrustPath(config: ProtectMeConfigLoadResult): string {
  const path = config.paths.projectConfigPath;
  const cwd = config.paths.cwd;
  if (cwd && path.startsWith(`${cwd}/`)) return `.${path.slice(cwd.length)}`;
  if (path.endsWith("/.pi/protectme.json")) return ".pi/protectme.json";

  return path;
}

function formatIgnoredProjectConfigStatus(config: ProtectMeConfigLoadResult): string {
  if (config.projectConfig.status !== "ignored") return "";

  return " • project config ignored";
}

function renderTopBorder(width: number, title: string, scope: string, theme: ProtectMePanelTheme): string {
  const innerWidth = Math.max(0, width - 2);
  const leftText = `─ ${sanitizeCellText(title)} `;
  const rightText = ` ${sanitizeCellText(scope)} ─`;
  const fillWidth = innerWidth - visibleWidth(leftText) - visibleWidth(rightText);
  const inner = fillWidth >= 0 ? `${leftText}${"─".repeat(fillWidth)}${rightText}` : fitLine(`${leftText}${rightText}`, innerWidth, "─");

  return theme.fg("accent", `╭${inner}╮`);
}

function renderBottomBorder(width: number, theme: ProtectMePanelTheme): string {
  return theme.fg("accent", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
}

function renderSeparator(width: number, theme: ProtectMePanelTheme): string {
  return theme.fg("accent", `├${"─".repeat(Math.max(0, width - 2))}┤`);
}

function renderFrameLine(width: number, content: string, theme: ProtectMePanelTheme): string {
  return `${theme.fg("accent", "│")}${fitLine(content, Math.max(0, width - 2))}${theme.fg("accent", "│")}`;
}

function fitValue(value: string, width: number, kind: SettingValueKind): string {
  if (kind === "path") return fitTail(value, width);

  return fitLine(sanitizeCellText(value), width);
}

function fitTail(value: string, width: number): string {
  const sanitizedValue = sanitizeCellText(value);
  if (visibleWidth(sanitizedValue) <= width) return sanitizedValue;
  if (width <= 0) return "";
  if (width === 1) return "…";

  return `…${sliceTailToWidth(sanitizedValue, width - 1)}`;
}

function sliceTailToWidth(value: string, width: number): string {
  let tail = value;

  while (visibleWidth(tail) > width && tail.length > 0) tail = tail.slice(1);

  return tail;
}

function sanitizeCellText(value: string): string {
  let sanitizedValue = "";

  for (const character of value) sanitizedValue += isControlCharacter(character) ? " " : character;

  return sanitizedValue.trim();
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;

  return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
}
