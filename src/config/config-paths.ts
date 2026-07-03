import { resolve } from "node:path";

import {
  GLOBAL_CONFIG_RELATIVE_PATH,
  PROJECT_CONFIG_RELATIVE_PATH,
  PROJECT_LOG_RELATIVE_PATH,
} from "../constants.ts";

export interface ProtectMeConfigPathInput {
  cwd: string;
  homeDir: string;
  projectTrusted?: boolean;
}

export interface ProtectMeConfigPaths extends ProtectMeConfigPathInput {
  globalConfigPath: string;
  projectConfigPath: string;
  blockedAttemptLogPath: string;
}

export function resolveGlobalConfigPath(homeDir: string): string {
  return resolve(homeDir, GLOBAL_CONFIG_RELATIVE_PATH);
}

export function resolveProjectConfigPath(cwd: string): string {
  return resolve(cwd, PROJECT_CONFIG_RELATIVE_PATH);
}

export function resolveBlockedAttemptLogPath(cwd: string): string {
  return resolve(cwd, PROJECT_LOG_RELATIVE_PATH);
}

export function resolveProtectMeConfigPaths(input: ProtectMeConfigPathInput): ProtectMeConfigPaths {
  return {
    cwd: input.cwd,
    homeDir: input.homeDir,
    globalConfigPath: resolveGlobalConfigPath(input.homeDir),
    projectConfigPath: resolveProjectConfigPath(input.cwd),
    blockedAttemptLogPath: resolveBlockedAttemptLogPath(input.cwd),
  };
}
