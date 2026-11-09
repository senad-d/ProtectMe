import { readFileSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

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

/**
 * Maps a cwd inside a linked git worktree to the same relative path in the main worktree,
 * so project config and the blocked-attempt log outlive temporary worktrees.
 * Returns the cwd unchanged outside git, in the main worktree, or when the layout is unexpected.
 */
export function resolveProjectRoot(cwd: string): string {
  const worktreeRoot = findGitEntryParent(resolve(cwd));
  if (!worktreeRoot) return cwd;

  const mainWorktreeRoot = readLinkedWorktreeMainRoot(worktreeRoot);
  if (!mainWorktreeRoot) return cwd;

  return resolve(mainWorktreeRoot, relative(worktreeRoot, resolve(cwd)));
}

function findGitEntryParent(startDir: string): string | null {
  let currentDir = startDir;

  while (!hasGitEntry(currentDir)) {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }

  return currentDir;
}

function hasGitEntry(dir: string): boolean {
  try {
    return statSync(resolve(dir, ".git"), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

function readLinkedWorktreeMainRoot(worktreeRoot: string): string | null {
  try {
    const gitEntryPath = resolve(worktreeRoot, ".git");
    if (!statSync(gitEntryPath).isFile()) return null;

    const gitEntry = readFileSync(gitEntryPath, "utf8");
    if (!gitEntry.startsWith("gitdir:")) return null;

    const gitDirPath = gitEntry.slice("gitdir:".length).trim();
    if (!gitDirPath) return null;

    const gitDir = resolve(worktreeRoot, gitDirPath);
    const commonDir = resolve(gitDir, readFileSync(resolve(gitDir, "commondir"), "utf8").trim());
    if (basename(commonDir) !== ".git") return null;

    return dirname(commonDir);
  } catch {
    return null;
  }
}

export function resolveProtectMeConfigPaths(input: ProtectMeConfigPathInput): ProtectMeConfigPaths {
  const agentDir = input.agentDir ?? resolveDefaultAgentDir(input.homeDir);
  const projectRoot = resolveProjectRoot(input.cwd);

  return {
    cwd: input.cwd,
    homeDir: input.homeDir,
    agentDir,
    globalConfigPath: resolveGlobalConfigPath(agentDir),
    projectConfigPath: resolveProjectConfigPath(projectRoot),
    blockedAttemptLogPath: resolveBlockedAttemptLogPath(projectRoot),
  };
}
