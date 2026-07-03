import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
  normalizeConfigAllowList,
  readProtectMeConfigSourceAllowListEntries,
  selectProtectMeConfigEditSource,
  type ProtectMeConfigLoadResult,
} from "../../config/index.ts";
import { EXTENSION_DISPLAY_NAME } from "../../constants.ts";
import type {
  ProtectMePanelCategory,
  ProtectMePanelSetting,
  ProtectMePanelState,
  ProtectMePanelStatusMessage,
  ProtectMePanelTheme,
  ProtectMePanelWriteTarget,
  SettingValueKind,
} from "./types.ts";

const WIDE_MODE_MIN_WIDTH = 72;
const TINY_MODE_MAX_WIDTH = 23;
const MAX_VISIBLE_SETTINGS = 10;
const PANEL_TITLE = EXTENSION_DISPLAY_NAME;

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
      label: "Write target",
      value: writeTarget,
      description: "Choose whether edits save to project or global config.",
      kind: "target",
      action: "chooseWriteTarget",
    },
    {
      label: "Add allow-list entry",
      value: `to ${writeTarget}`,
      description: `Add a cleaned editable host entry to ${writeTarget} config.`,
      kind: "action",
      action: "addEntry",
    },
    {
      label: "Remove allow-list entry",
      value: `${writeTarget} (${countTargetSites(config, writeTarget)})`,
      description: `Remove a host entry from ${writeTarget} config.`,
      kind: "action",
      action: "removeEntry",
    },
    {
      label: "Global config path",
      value: config.paths.globalConfigPath,
      description: "Global ProtectMe config path.",
      kind: "path",
    },
    {
      label: "Project config path",
      value: config.paths.projectConfigPath,
      description: "Project ProtectMe config path.",
      kind: "path",
    },
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
    {
      label: "Effective site count",
      value: String(config.effective.allowList.length),
      description: "Normalized effective allow-list entry count.",
      kind: "count",
    },
    {
      label: "Recent blocked hosts",
      value: formatRecentBlockedHosts(state.recentBlockedHosts),
      description: "Most recent blocked hosts recorded in the ProtectMe log.",
      kind: "text",
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
  if (width >= WIDE_MODE_MIN_WIDTH) {
    return renderWidePanel(width, state, selectedSettingIndex, writeTarget, statusMessage, theme);
  }

  return renderNarrowPanel(width, state, selectedSettingIndex, writeTarget, statusMessage, theme);
}

function renderWidePanel(
  width: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  const leftPaneWidth = Math.min(22, Math.max(16, Math.floor(width * 0.27)));
  const rightPaneWidth = Math.max(10, width - leftPaneWidth - 3);
  const categories = buildProtectMePanelCategories(state, writeTarget);
  const rightRows = renderSettingsRows(rightPaneWidth, state, selectedSettingIndex, writeTarget, theme);
  const bodyHeight = Math.max(categories.length, rightRows.length, 8);
  const lines = [renderTopBorder(width, PANEL_TITLE, buildScopeLabel(state), theme)];

  lines.push(renderFrameLine(width, buildSourceLine(state, writeTarget), theme));
  lines.push(renderFrameLine(width, "↑↓ move  Enter action  p/g target  q quit", theme));
  lines.push(renderWideSeparator(leftPaneWidth, rightPaneWidth, "┬", theme));

  for (let index = 0; index < bodyHeight; index += 1) {
    lines.push(renderWideBodyLine(leftPaneWidth, rightPaneWidth, renderCategoryCell(categories, index, theme), rightRows[index] ?? "", theme));
  }

  lines.push(renderWideSeparator(leftPaneWidth, rightPaneWidth, "┴", theme));
  lines.push(renderFrameLine(width, buildFooterText(state, selectedSettingIndex, writeTarget, statusMessage), theme));
  lines.push(renderBottomBorder(width, theme));

  return lines;
}

function renderNarrowPanel(
  width: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  const innerWidth = width - 2;
  const rows = renderSettingsRows(innerWidth, state, selectedSettingIndex, writeTarget, theme);
  const bodyHeight = Math.max(rows.length, 8);
  const lines = [renderTopBorder(width, PANEL_TITLE, buildScopeLabel(state), theme)];

  lines.push(renderFrameLine(width, buildSourceLine(state, writeTarget), theme));
  lines.push(renderFrameLine(width, "↑↓ move  Enter action  p/g target  q quit", theme));
  lines.push(renderNarrowSeparator(width, theme));

  for (let index = 0; index < bodyHeight; index += 1) lines.push(renderFrameLine(width, rows[index] ?? "", theme));

  lines.push(renderNarrowSeparator(width, theme));
  lines.push(renderFrameLine(width, buildFooterText(state, selectedSettingIndex, writeTarget, statusMessage), theme));
  lines.push(renderBottomBorder(width, theme));

  return lines;
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

function buildProtectMePanelCategories(state: ProtectMePanelState, writeTarget: ProtectMePanelWriteTarget): ProtectMePanelCategory[] {
  return [
    {
      label: "Configuration",
      description: "Current ProtectMe configuration state.",
      settings: buildProtectMePanelSettings(state, writeTarget),
    },
  ];
}

function countTargetSites(config: ProtectMeConfigLoadResult, writeTarget: ProtectMePanelWriteTarget): number {
  return readProtectMeConfigSourceAllowListEntries(selectProtectMeConfigEditSource(config, writeTarget)).length;
}

function countConfigSites(allowList: string[] | undefined): number {
  if (!allowList) return 0;

  return normalizeConfigAllowList(allowList).length;
}

function formatRecentBlockedHosts(hosts: string[]): string {
  if (hosts.length === 0) return "none";

  return hosts.join(", ");
}

function renderSettingsRows(
  paneWidth: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  theme: ProtectMePanelTheme,
): string[] {
  const settings = buildProtectMePanelSettings(state, writeTarget);
  const safeSelectedIndex = clamp(selectedSettingIndex, 0, Math.max(0, settings.length - 1));
  const windowStart = calculateWindowStart(settings.length, safeSelectedIndex);
  const visibleSettings = settings.slice(windowStart, windowStart + MAX_VISIBLE_SETTINGS);
  const counter = buildCounter(safeSelectedIndex, settings.length);
  const rows = [renderSettingsHeader(paneWidth, "Configuration", counter, theme)];

  for (let index = 0; index < visibleSettings.length; index += 1) {
    const settingIndex = windowStart + index;
    rows.push(renderSettingRow(paneWidth, visibleSettings[index]!, settingIndex === safeSelectedIndex, theme));
  }

  return rows;
}

function renderSettingsHeader(paneWidth: number, title: string, counter: string, theme: ProtectMePanelTheme): string {
  const safeWidth = Math.max(0, paneWidth);
  const styledCounter = theme.fg("dim", counter);
  const counterWidth = visibleWidth(counter);
  const titleWidth = Math.max(0, safeWidth - counterWidth - 1);
  const styledTitle = theme.fg("accent", theme.bold(fitLine(title.toUpperCase(), titleWidth)));
  const gap = Math.max(1, safeWidth - visibleWidth(styledTitle) - visibleWidth(styledCounter));

  return fitLine(`${styledTitle}${" ".repeat(gap)}${styledCounter}`, safeWidth);
}

function renderSettingRow(paneWidth: number, setting: ProtectMePanelSetting, selected: boolean, theme: ProtectMePanelTheme): string {
  const safeWidth = Math.max(0, paneWidth);
  const valueWidth = Math.max(0, Math.min(28, Math.floor(safeWidth * 0.4)));
  const labelWidth = Math.max(1, safeWidth - 2 - 1 - valueWidth);
  const prefix = selected ? theme.fg("accent", "▶ ") : "  ";
  const label = styleSettingLabel(fitLine(setting.label, labelWidth), selected, theme);
  const value = styleSettingValue(fitValue(setting.value, valueWidth, setting.kind), setting, theme);
  const labelPadding = " ".repeat(Math.max(0, labelWidth - visibleWidth(label)));
  const valuePadding = " ".repeat(Math.max(0, valueWidth - visibleWidth(value)));

  return fitLine(`${prefix}${label}${labelPadding} ${valuePadding}${value}`, safeWidth);
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

function renderCategoryCell(categories: ProtectMePanelCategory[], index: number, theme: ProtectMePanelTheme): string {
  const category = categories[index];
  if (!category) return "";

  return `${theme.fg("accent", "▶ ")}${theme.fg("accent", theme.bold(category.label))}`;
}

function buildFooterText(
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
): string {
  const settings = buildProtectMePanelSettings(state, writeTarget);
  const selectedSetting = settings[clamp(selectedSettingIndex, 0, Math.max(0, settings.length - 1))];
  const footer = selectedSetting
    ? `${buildCounter(selectedSettingIndex, settings.length)} • ${selectedSetting.description}`
    : "0/0 • Current ProtectMe configuration state.";

  if (!statusMessage) return footer;

  return `${statusMessage.text} • ${footer}`;
}

function buildCounter(selectedIndex: number, count: number): string {
  if (count === 0) return "0/0";

  return `${clamp(selectedIndex, 0, count - 1) + 1}/${count}`;
}

function calculateWindowStart(count: number, selectedIndex: number): number {
  if (count <= MAX_VISIBLE_SETTINGS) return 0;

  const centeredStart = selectedIndex - Math.floor(MAX_VISIBLE_SETTINGS / 2);
  return clamp(centeredStart, 0, count - MAX_VISIBLE_SETTINGS);
}

function buildSourceLine(state: ProtectMePanelState, writeTarget: ProtectMePanelWriteTarget): string {
  const projectStatus = formatIgnoredProjectConfigStatus(state.config);

  return `writes ${writeTarget} config • effective ${state.config.effective.mode}${projectStatus}`;
}

function buildScopeLabel(state: ProtectMePanelState): string {
  return `${state.config.effective.mode} mode`;
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

function renderNarrowSeparator(width: number, theme: ProtectMePanelTheme): string {
  return theme.fg("accent", `├${"─".repeat(Math.max(0, width - 2))}┤`);
}

function renderWideSeparator(leftPaneWidth: number, rightPaneWidth: number, junction: "┬" | "┴", theme: ProtectMePanelTheme): string {
  return theme.fg("accent", `├${"─".repeat(leftPaneWidth)}${junction}${"─".repeat(rightPaneWidth)}┤`);
}

function renderFrameLine(width: number, content: string, theme: ProtectMePanelTheme): string {
  return `${theme.fg("accent", "│")}${fitLine(content, Math.max(0, width - 2))}${theme.fg("accent", "│")}`;
}

function renderWideBodyLine(
  leftPaneWidth: number,
  rightPaneWidth: number,
  leftContent: string,
  rightContent: string,
  theme: ProtectMePanelTheme,
): string {
  return [
    theme.fg("accent", "│"),
    fitLine(leftContent, leftPaneWidth),
    theme.fg("accent", "│"),
    fitLine(rightContent, rightPaneWidth),
    theme.fg("accent", "│"),
  ].join("");
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
