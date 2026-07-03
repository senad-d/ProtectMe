import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { normalizeAllowListEntries } from "../policy/host-matcher.ts";
import { normalizeHostInput } from "../policy/host-normalization.ts";
import { resolveProtectMeConfigPaths, type ProtectMeConfigPathInput, type ProtectMeConfigPaths } from "./config-paths.ts";
import {
  DEFAULT_PROTECTME_ALLOW_LIST,
  DEFAULT_PROTECTME_MODE,
  createDefaultProtectMeConfig,
  type EffectiveProtectMeConfig,
  type ParsedProtectMeConfig,
  type ProtectMeConfigFile,
  type ProtectMeConfigLoadResult,
  type ProtectMeConfigSource,
  type ProtectMeMode,
} from "./config-types.ts";

const CONFIG_JSON_INDENT = 2;
const PROJECT_CONFIG_IGNORED_MESSAGE = "Project config was not read because the current project is not trusted.";
const configMutationQueues = new Map<string, Promise<unknown>>();
let temporaryConfigWriteCounter = 0;

export type ProtectMeConfigMutation = (config: ProtectMeConfigFile) => ProtectMeConfigFile | Promise<ProtectMeConfigFile>;

export function normalizeConfigAllowListEntry(rawEntry: string): string | null {
  return normalizeHostInput(rawEntry).host;
}

export function normalizeConfigAllowList(entries: string[]): string[] {
  return normalizeAllowListEntries(entries).entries;
}

export async function readProtectMeConfigSource(
  source: ProtectMeConfigSource,
  path: string,
): Promise<ParsedProtectMeConfig> {
  try {
    const text = await readFile(path, "utf8");
    return parseProtectMeConfigText(source, path, text);
  } catch (error) {
    return buildReadErrorConfigSource(source, path, error);
  }
}

export function parseProtectMeConfigText(
  source: ProtectMeConfigSource,
  path: string,
  text: string,
): ParsedProtectMeConfig {
  try {
    return validateProtectMeConfigValue(source, path, JSON.parse(text) as unknown);
  } catch (error) {
    return {
      source,
      path,
      status: "invalid",
      message: buildJsonParseErrorMessage(error),
      config: null,
    };
  }
}

export function mergeProtectMeConfigs(
  globalConfig: ParsedProtectMeConfig,
  projectConfig: ParsedProtectMeConfig,
): EffectiveProtectMeConfig {
  const configSources = [globalConfig, projectConfig];
  const configWarnings = collectConfigWarnings(configSources);
  if (hasFailClosedConfigSource(configSources)) return buildFailClosedEffectiveConfig(configSources, configWarnings);

  const mode = resolveEffectiveMode(globalConfig, projectConfig);
  const modeSource = resolveEffectiveModeSource(globalConfig, projectConfig);
  const allowListMerge = mergeAllowListEntries(globalConfig, projectConfig);
  const warnings = [...configWarnings, ...allowListMerge.warnings];

  return {
    mode,
    allowList: allowListMerge.allowList,
    modeSource,
    allowListSources: allowListMerge.allowListSources,
    configSources,
    warnings,
  };
}

export async function loadProtectMeConfig(input: ProtectMeConfigPathInput | ProtectMeConfigPaths): Promise<ProtectMeConfigLoadResult> {
  const paths = "globalConfigPath" in input ? input : resolveProtectMeConfigPaths(input);
  const globalConfig = await readProtectMeConfigSource("global", paths.globalConfigPath);
  const projectConfig = shouldReadProjectConfig(input)
    ? await readProtectMeConfigSource("project", paths.projectConfigPath)
    : buildIgnoredProjectConfigSource(paths.projectConfigPath);

  return {
    paths,
    globalConfig,
    projectConfig,
    effective: mergeProtectMeConfigs(globalConfig, projectConfig),
  };
}

export async function loadProtectMeConfigWithGlobalDefault(
  input: ProtectMeConfigPathInput | ProtectMeConfigPaths,
): Promise<ProtectMeConfigLoadResult> {
  const paths = "globalConfigPath" in input ? input : resolveProtectMeConfigPaths(input);

  try {
    await ensureGlobalProtectMeConfig(paths);
  } catch (error) {
    const config = await loadProtectMeConfig(input);

    return appendGlobalConfigInitializationWarning(config, error);
  }

  return loadProtectMeConfig(input);
}

export async function ensureGlobalProtectMeConfig(
  paths: Pick<ProtectMeConfigPaths, "globalConfigPath">,
  defaultConfig: ProtectMeConfigFile = createDefaultProtectMeConfig(),
): Promise<boolean> {
  return enqueueConfigMutation(paths.globalConfigPath, () => ensureProtectMeConfigFileUnlocked("global", paths.globalConfigPath, defaultConfig));
}

export async function writeProtectMeConfigFile(path: string, config: ProtectMeConfigFile): Promise<void> {
  await writeProtectMeConfigFileUnlocked(path, config);
}

export async function mutateProtectMeConfigFile(
  source: ProtectMeConfigSource,
  path: string,
  mutation: ProtectMeConfigMutation,
): Promise<ProtectMeConfigFile> {
  return enqueueConfigMutation(path, () => mutateProtectMeConfigFileUnlocked(source, path, mutation));
}

export async function mutateGlobalProtectMeConfig(
  paths: Pick<ProtectMeConfigPaths, "globalConfigPath">,
  mutation: ProtectMeConfigMutation,
): Promise<ProtectMeConfigFile> {
  return mutateProtectMeConfigFile("global", paths.globalConfigPath, mutation);
}

export async function mutateProjectProtectMeConfig(
  paths: Pick<ProtectMeConfigPaths, "projectConfigPath">,
  mutation: ProtectMeConfigMutation,
): Promise<ProtectMeConfigFile> {
  return mutateProtectMeConfigFile("project", paths.projectConfigPath, mutation);
}

export async function writeGlobalProtectMeConfig(
  paths: Pick<ProtectMeConfigPaths, "globalConfigPath">,
  config: ProtectMeConfigFile,
): Promise<void> {
  await writeProtectMeConfigFile(paths.globalConfigPath, config);
}

export async function writeProjectProtectMeConfig(
  paths: Pick<ProtectMeConfigPaths, "projectConfigPath">,
  config: ProtectMeConfigFile,
): Promise<void> {
  await writeProtectMeConfigFile(paths.projectConfigPath, config);
}

interface AllowListMergeResult {
  allowList: string[];
  allowListSources: ProtectMeConfigSource[];
  warnings: string[];
}

function validateProtectMeConfigValue(
  source: ProtectMeConfigSource,
  path: string,
  value: unknown,
): ParsedProtectMeConfig {
  if (!isPlainRecord(value)) return buildInvalidConfigSource(source, path, "Config root must be a JSON object.");

  const mode = validateMode(value.mode);
  if (mode === "invalid") {
    return buildInvalidConfigSource(source, path, 'Config field "mode" must be "block" or "allow" when present.');
  }

  const allowList = validateAllowList(value.allowList);
  if (allowList === "invalid") {
    return buildInvalidConfigSource(source, path, 'Config field "allowList" must be an array of strings when present.');
  }

  return {
    source,
    path,
    status: "valid",
    config: buildConfigFile(mode, allowList),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMode(value: unknown): ProtectMeMode | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === "block" || value === "allow") return value;

  return "invalid";
}

function validateAllowList(value: unknown): string[] | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return "invalid";
  if (!value.every((entry) => typeof entry === "string")) return "invalid";

  return value;
}

function buildConfigFile(mode: ProtectMeMode | undefined, allowList: string[] | undefined): ProtectMeConfigFile {
  const config: ProtectMeConfigFile = {};
  if (mode) config.mode = mode;
  if (allowList) config.allowList = allowList;

  return config;
}

function buildInvalidConfigSource(
  source: ProtectMeConfigSource,
  path: string,
  message: string,
): ParsedProtectMeConfig {
  return {
    source,
    path,
    status: "invalid",
    message,
    config: null,
  };
}

function buildIgnoredProjectConfigSource(path: string): ParsedProtectMeConfig {
  return {
    source: "project",
    path,
    status: "ignored",
    message: PROJECT_CONFIG_IGNORED_MESSAGE,
    config: null,
  };
}

function buildReadErrorConfigSource(
  source: ProtectMeConfigSource,
  path: string,
  error: unknown,
): ParsedProtectMeConfig {
  if (isNodeError(error) && error.code === "ENOENT") {
    return {
      source,
      path,
      status: "missing",
      config: null,
    };
  }

  return {
    source,
    path,
    status: "unreadable",
    message: buildReadErrorMessage(error),
    config: null,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function buildJsonParseErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);

  return `Invalid JSON: ${detail}`;
}

function buildReadErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);

  return `Unable to read ProtectMe config: ${detail}`;
}

function collectConfigWarnings(configSources: ParsedProtectMeConfig[]): string[] {
  return configSources
    .filter(hasConfigWarning)
    .map((configSource) => `${configSource.source} config ${configSource.status}: ${configSource.message ?? "unknown error"}`);
}

function hasConfigWarning(configSource: ParsedProtectMeConfig): boolean {
  return configSource.status === "invalid" || configSource.status === "unreadable" || configSource.status === "ignored";
}

function hasFailClosedConfigSource(configSources: ParsedProtectMeConfig[]): boolean {
  return configSources.some(isFailClosedConfigSource);
}

function isFailClosedConfigSource(configSource: ParsedProtectMeConfig): boolean {
  return configSource.status === "invalid" || configSource.status === "unreadable";
}

function buildFailClosedEffectiveConfig(
  configSources: ParsedProtectMeConfig[],
  warnings: string[],
): EffectiveProtectMeConfig {
  return {
    mode: DEFAULT_PROTECTME_MODE,
    allowList: [],
    modeSource: "default",
    allowListSources: [],
    configSources,
    warnings: [...warnings, buildFailClosedConfigWarning(configSources)],
  };
}

function buildFailClosedConfigWarning(configSources: ParsedProtectMeConfig[]): string {
  const failedSources = configSources.filter(isFailClosedConfigSource).map(formatFailClosedSource);

  return `Effective config failed closed because ${failedSources.join(" and ")}; mode "block" and empty allowList are in use.`;
}

function formatFailClosedSource(configSource: ParsedProtectMeConfig): string {
  return `${configSource.source} config ${configSource.status}`;
}

function resolveEffectiveMode(
  globalConfig: ParsedProtectMeConfig,
  projectConfig: ParsedProtectMeConfig,
): ProtectMeMode {
  if (projectConfig.status === "valid" && projectConfig.config?.mode) return projectConfig.config.mode;
  if (globalConfig.status === "valid" && globalConfig.config?.mode) return globalConfig.config.mode;

  return DEFAULT_PROTECTME_MODE;
}

function resolveEffectiveModeSource(
  globalConfig: ParsedProtectMeConfig,
  projectConfig: ParsedProtectMeConfig,
): EffectiveProtectMeConfig["modeSource"] {
  if (projectConfig.status === "valid" && projectConfig.config?.mode) return "project";
  if (globalConfig.status === "valid" && globalConfig.config?.mode) return "global";

  return "default";
}

function mergeAllowListEntries(
  globalConfig: ParsedProtectMeConfig,
  projectConfig: ParsedProtectMeConfig,
): AllowListMergeResult {
  const defaultAllowList = normalizeAllowListEntries([...DEFAULT_PROTECTME_ALLOW_LIST]);
  const allowList: string[] = [...defaultAllowList.entries];
  const allowListSources: ProtectMeConfigSource[] = [];
  const seenEntries = new Set<string>(allowList);
  const warnings: string[] = [];

  appendAllowListEntries(globalConfig, allowList, allowListSources, seenEntries, warnings);
  appendAllowListEntries(projectConfig, allowList, allowListSources, seenEntries, warnings);

  return { allowList, allowListSources, warnings };
}

function appendAllowListEntries(
  configSource: ParsedProtectMeConfig,
  allowList: string[],
  allowListSources: ProtectMeConfigSource[],
  seenEntries: Set<string>,
  warnings: string[],
): void {
  if (configSource.status !== "valid" || !configSource.config?.allowList) return;

  const normalizedAllowList = normalizeAllowListEntries(configSource.config.allowList);
  let addedEntry = false;
  for (const entry of normalizedAllowList.entries) {
    if (seenEntries.has(entry)) continue;

    seenEntries.add(entry);
    allowList.push(entry);
    addedEntry = true;
  }

  appendAllowListWarnings(configSource.source, warnings, normalizedAllowList.warnings);
  if (addedEntry) allowListSources.push(configSource.source);
}

function appendAllowListWarnings(
  source: ProtectMeConfigSource,
  warnings: string[],
  allowListWarnings: { input: string; message: string }[],
): void {
  for (const warning of allowListWarnings) {
    warnings.push(`${source} allowList entry ignored (${JSON.stringify(warning.input)}): ${warning.message}`);
  }
}

function shouldReadProjectConfig(input: ProtectMeConfigPathInput | ProtectMeConfigPaths): boolean {
  return input.projectTrusted !== false;
}

async function writeProtectMeConfigFileUnlocked(path: string, config: ProtectMeConfigFile): Promise<void> {
  const serializedConfig = `${JSON.stringify(config, null, CONFIG_JSON_INDENT)}\n`;
  const temporaryPath = buildTemporaryConfigPath(path);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, serializedConfig, "utf8");
  await rename(temporaryPath, path);
}

async function mutateProtectMeConfigFileUnlocked(
  source: ProtectMeConfigSource,
  path: string,
  mutation: ProtectMeConfigMutation,
): Promise<ProtectMeConfigFile> {
  const currentSource = await readProtectMeConfigSource(source, path);
  assertConfigSourceCanMutate(currentSource);

  const nextConfig = await mutation(currentSource.config ?? {});
  await writeProtectMeConfigFileUnlocked(path, nextConfig);

  return nextConfig;
}

async function ensureProtectMeConfigFileUnlocked(
  source: ProtectMeConfigSource,
  path: string,
  defaultConfig: ProtectMeConfigFile,
): Promise<boolean> {
  const currentSource = await readProtectMeConfigSource(source, path);
  if (currentSource.status !== "missing") return false;

  await writeProtectMeConfigFileUnlocked(path, defaultConfig);

  return true;
}

async function enqueueConfigMutation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previousOperation = configMutationQueues.get(path) ?? Promise.resolve();
  const nextOperation = previousOperation.then(operation, operation);
  const cleanupOperation = nextOperation.then(ignoreQueueResult, ignoreQueueResult);

  configMutationQueues.set(path, cleanupOperation);

  try {
    return await nextOperation;
  } finally {
    if (configMutationQueues.get(path) === cleanupOperation) configMutationQueues.delete(path);
  }
}

function assertConfigSourceCanMutate(configSource: ParsedProtectMeConfig): void {
  if (configSource.status !== "invalid" && configSource.status !== "unreadable") return;

  const detail = configSource.message ? `: ${configSource.message}` : "";
  throw new Error(`${configSource.source} config is ${configSource.status}${detail}`);
}

function ignoreQueueResult(): void {
  // Keep the queue chain alive after either success or failure.
}

function appendGlobalConfigInitializationWarning(
  config: ProtectMeConfigLoadResult,
  error: unknown,
): ProtectMeConfigLoadResult {
  return {
    ...config,
    effective: {
      ...config.effective,
      warnings: [...config.effective.warnings, `global config initialization failed: ${buildReadErrorMessage(error)}`],
    },
  };
}

function buildTemporaryConfigPath(path: string): string {
  temporaryConfigWriteCounter += 1;

  return `${path}.${process.pid}.${Date.now()}.${temporaryConfigWriteCounter}.tmp`;
}
