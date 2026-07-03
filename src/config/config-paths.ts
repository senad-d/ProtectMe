import { resolve } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir as getPiAgentDir } from "@earendil-works/pi-coding-agent";

import { PROTECTME_AGENT_SUBDIR_NAME, PROTECTME_CONFIG_FILE_NAME, PROTECTME_LOG_FILE_NAME } from "../constants.ts";

export interface ProtectMeConfigPathInput {
  cwd: string;
  homeDir?: string;
  agentDir?: string;
  projectTrusted?: boolean;
}

export interface ProtectMeConfigPaths extends ProtectMeConfigPathInput {
  agentDir: string;
  globalConfigPath: string;
  projectConfigPath: string;
  blockedAttemptLogPath: string;
}

export function resolveDefaultAgentDir(homeDir?: string): string {
  if (homeDir) return resolve(homeDir, CONFIG_DIR_NAME, PROTECTME_AGENT_SUBDIR_NAME);

  return getPiAgentDir();
}

export function resolveGlobalConfigPath(agentDir: string = getPiAgentDir()): string {
  return resolve(agentDir, PROTECTME_CONFIG_FILE_NAME);
}

export function resolveProjectConfigPath(cwd: string): string {
  return resolve(cwd, CONFIG_DIR_NAME, PROTECTME_CONFIG_FILE_NAME);
}

export function resolveBlockedAttemptLogPath(cwd: string): string {
  return resolve(cwd, CONFIG_DIR_NAME, PROTECTME_AGENT_SUBDIR_NAME, PROTECTME_LOG_FILE_NAME);
}

export function resolveProtectMeConfigPaths(input: ProtectMeConfigPathInput): ProtectMeConfigPaths {
  const agentDir = input.agentDir ?? resolveDefaultAgentDir(input.homeDir);

  return {
    cwd: input.cwd,
    homeDir: input.homeDir,
    agentDir,
    globalConfigPath: resolveGlobalConfigPath(agentDir),
    projectConfigPath: resolveProjectConfigPath(input.cwd),
    blockedAttemptLogPath: resolveBlockedAttemptLogPath(input.cwd),
  };
}
