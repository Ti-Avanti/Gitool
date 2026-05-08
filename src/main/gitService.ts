import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { promisify, TextDecoder } from "node:util";
import type {
  EffectiveLanguage,
  GitBranch,
  GitCommandResult,
  GitFileStatus,
  GitGraphEntry,
  GitLogEntry,
  GitRemote,
  GitSnapshot,
  PullMode,
  Project,
  ResetMode,
  RemoteSyncState
} from "../shared/types";
import { serverMessage } from "../shared/serverMessages";

const execFileAsync = promisify(execFile);
const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

type ExecOk = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export class GitService {
  constructor(private readonly getLanguage: () => EffectiveLanguage) {}

  async resolveRepository(inputPath: string): Promise<string> {
    const absolutePath = path.resolve(inputPath);
    if (!existsSync(absolutePath)) {
      throw new Error(this.message("directoryMissing"));
    }
    if (!statSync(absolutePath).isDirectory()) {
      throw new Error(this.message("directoryMissing"));
    }
    const result = await this.git(absolutePath, ["rev-parse", "--show-toplevel"], true);
    return path.resolve(result.stdout.trim());
  }

  async snapshot(project: Project): Promise<GitSnapshot> {
    const [status, branches, remotes, logs, graphLog, stashes, tags, head] = await Promise.all([
      this.git(project.path, ["status", "--porcelain=v1", "-b", "-uall"], true),
      this.git(project.path, ["branch", "--format=%(HEAD)|%(refname:short)|%(upstream:short)"], true),
      this.git(project.path, ["remote", "-v"], true),
      this.git(project.path, ["log", "--oneline", "--decorate", "-30"], false),
      this.git(project.path, ["log", "--all", "--graph", "--date-order", "--decorate=short", "--pretty=format:%x1f%H%x1f%h%x1f%P%x1f%D%x1f%s", "-80"], false),
      this.git(project.path, ["stash", "list"], false),
      this.git(project.path, ["tag", "--list"], false),
      this.git(project.path, ["rev-parse", "HEAD"], false)
    ]);

    const branchInfo = parseBranchHeader(status.stdout);
    const files = parseStatusFiles(status.stdout);
    const upstreamSha = branchInfo.upstream
      ? (await this.git(project.path, ["rev-parse", "--verify", branchInfo.upstream], false)).stdout.trim() || undefined
      : undefined;

    return {
      projectId: project.id,
      branch: branchInfo.branch,
      upstream: branchInfo.upstream,
      headSha: head.stdout.trim(),
      upstreamSha,
      remoteSync: remoteSyncState(branchInfo.upstream, branchInfo.ahead, branchInfo.behind),
      ahead: branchInfo.ahead,
      behind: branchInfo.behind,
      clean: files.length === 0,
      files,
      branches: parseBranches(branches.stdout),
      remotes: parseRemotes(remotes.stdout),
      logs: parseLogs(logs.stdout),
      graph: parseGraphEntries(graphLog.stdout, head.stdout.trim(), upstreamSha),
      stashes: stashes.stdout.split(/\r?\n/).filter(Boolean),
      tags: tags.stdout.split(/\r?\n/).filter(Boolean)
    };
  }

  async diff(project: Project, filePath: string, staged: boolean): Promise<string> {
    const status = await this.git(project.path, ["status", "--porcelain=v1", "--", filePath], false);
    if (status.stdout.startsWith("??")) {
      return this.message("untrackedDiffUnavailable");
    }
    const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
    const result = await this.git(project.path, args, false);
    return result.stdout || result.stderr || this.message("noDiff");
  }

  stage(project: Project, paths: string[]): Promise<GitCommandResult> {
    this.ensurePaths(paths);
    return this.command(project.path, ["add", "--", ...paths]);
  }

  unstage(project: Project, paths: string[]): Promise<GitCommandResult> {
    this.ensurePaths(paths);
    return this.command(project.path, ["restore", "--staged", "--", ...paths]);
  }

  async commit(project: Project, paths: string[], message: string): Promise<GitCommandResult> {
    this.ensurePaths(paths);
    if (!message.trim()) {
      throw new Error(this.message("commitMessageRequired"));
    }
    await this.git(project.path, ["add", "--", ...paths], true);
    return this.command(project.path, ["commit", "-m", message.trim(), "--", ...paths]);
  }

  fetch(project: Project): Promise<GitCommandResult> {
    return this.command(project.path, ["fetch", "--all", "--prune"]);
  }

  pull(project: Project, mode: PullMode): Promise<GitCommandResult> {
    const modeArgs: Record<PullMode, string[]> = {
      "ff-only": ["--ff-only"],
      rebase: ["--rebase"],
      merge: ["--no-rebase"]
    };
    return this.command(project.path, ["pull", ...modeArgs[mode]]);
  }

  async push(project: Project): Promise<GitCommandResult> {
    const branch = (await this.git(project.path, ["rev-parse", "--abbrev-ref", "HEAD"], false)).stdout.trim();
    if (!branch || branch === "HEAD") {
      return {
        ok: false,
        stdout: "",
        stderr: this.message("pushNoBranch"),
        command: "git rev-parse --abbrev-ref HEAD"
      };
    }

    const upstreamResult = await this.git(project.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], false);
    const upstream = upstreamResult.ok ? upstreamResult.stdout.trim() : "";
    const remotes = parseRemotes((await this.git(project.path, ["remote", "-v"], false)).stdout);
    const target = resolvePushTarget(upstream, remotes, branch);
    if (!target) {
      return {
        ok: false,
        stdout: "",
        stderr: this.message("pushNoRemote"),
        command: "git remote -v"
      };
    }

    const pushArgs = upstream
      ? ["push", target.remoteName, `${branch}:refs/heads/${target.remoteBranch}`]
      : ["push", "-u", target.remoteName, `${branch}:refs/heads/${target.remoteBranch}`];
    const pushResult = await this.command(project.path, pushArgs);
    if (!pushResult.ok) {
      return pushResult;
    }

    const localHead = (await this.git(project.path, ["rev-parse", "HEAD"], false)).stdout.trim();
    const remoteResult = await this.git(project.path, ["ls-remote", target.remoteName, `refs/heads/${target.remoteBranch}`], false);
    const remoteHead = parseLsRemoteHead(remoteResult.stdout);
    if (!remoteResult.ok || !remoteHead || remoteHead !== localHead) {
      return {
        ok: false,
        stdout: [pushResult.stdout, `local: ${localHead}`, `remote: ${remoteHead || "missing"}`].filter(Boolean).join("\n"),
        stderr: [pushResult.stderr, this.message("pushVerificationFailed")].filter(Boolean).join("\n"),
        command: `${pushResult.command} && git ls-remote ${target.remoteName} refs/heads/${target.remoteBranch}`
      };
    }

    await this.git(project.path, ["fetch", "--prune", target.remoteName], false);
    return {
      ok: true,
      stdout: [pushResult.stdout, this.message("pushVerified"), `${target.remoteName}/${target.remoteBranch}: ${remoteHead}`]
        .filter(Boolean)
        .join("\n"),
      stderr: pushResult.stderr,
      command: pushResult.command
    };
  }

  createBranch(project: Project, name: string, startPoint?: string): Promise<GitCommandResult> {
    const args = startPoint?.trim() ? ["switch", "-c", name, startPoint.trim()] : ["switch", "-c", name];
    return this.command(project.path, args);
  }

  switchBranch(project: Project, branch: string): Promise<GitCommandResult> {
    return this.command(project.path, ["switch", branch]);
  }

  deleteBranch(project: Project, branch: string): Promise<GitCommandResult> {
    return this.command(project.path, ["branch", "-d", branch]);
  }

  createStash(project: Project, message: string): Promise<GitCommandResult> {
    const args = message.trim() ? ["stash", "push", "-u", "-m", message.trim()] : ["stash", "push", "-u"];
    return this.command(project.path, args);
  }

  applyStash(project: Project, stashRef: string): Promise<GitCommandResult> {
    return this.command(project.path, ["stash", "apply", stashRef]);
  }

  dropStash(project: Project, stashRef: string): Promise<GitCommandResult> {
    return this.command(project.path, ["stash", "drop", stashRef]);
  }

  createTag(project: Project, name: string, message?: string): Promise<GitCommandResult> {
    const args = message?.trim() ? ["tag", "-a", name, "-m", message.trim()] : ["tag", name];
    return this.command(project.path, args);
  }

  deleteTag(project: Project, tag: string): Promise<GitCommandResult> {
    return this.command(project.path, ["tag", "-d", tag]);
  }

  rebaseOnto(project: Project, target: string): Promise<GitCommandResult> {
    return this.command(project.path, ["rebase", target]);
  }

  resetToCommit(project: Project, hash: string, mode: ResetMode): Promise<GitCommandResult> {
    return this.command(project.path, ["reset", `--${mode}`, hash.trim()]);
  }

  private async command(cwd: string, args: string[]): Promise<GitCommandResult> {
    const result = await this.git(cwd, args, false);
    return {
      ok: result.ok,
      stdout: result.stdout,
      stderr: result.stderr,
      command: `git ${args.join(" ")}`
    };
  }

  private async git(cwd: string, args: string[], throwOnError: boolean): Promise<ExecOk> {
    const gitArgs = ["-c", "core.quotePath=false", "-c", "i18n.logOutputEncoding=utf-8", ...args];
    try {
      const result = await execFileAsync("git", gitArgs, {
        cwd,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
        encoding: "buffer",
        env: {
          ...process.env,
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8"
        }
      });
      return {
        ok: true,
        stdout: decodeGitOutput(result.stdout),
        stderr: decodeGitOutput(result.stderr)
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
      const stderr = decodeGitOutput(err.stderr);
      const stdout = decodeGitOutput(err.stdout);
      if (throwOnError) {
        throw new Error((stderr || err.message || this.message("gitCommandFailed")).trim());
      }
      return {
        ok: false,
        stdout,
        stderr: stderr || err.message || this.message("gitCommandFailed")
      };
    }
  }

  private message(key: Parameters<typeof serverMessage>[1]): string {
    return serverMessage(this.getLanguage(), key);
  }

  private ensurePaths(paths: string[]): void {
    if (!paths.length) {
      throw new Error(this.message("selectFilesRequired"));
    }
  }
}

function parseBranchHeader(stdout: string): Pick<GitSnapshot, "branch" | "upstream" | "ahead" | "behind"> {
  const header = stdout.split(/\r?\n/).find((line) => line.startsWith("##"));
  if (!header) {
    return { branch: "HEAD", ahead: 0, behind: 0 };
  }

  const content = header.replace(/^##\s*/, "");
  const match = content.match(/^(.+?)(?:\.\.\.(.+?))?(?:\s+\[(.+)\])?$/);
  const branch = match?.[1] ?? content;
  const upstream = match?.[2];
  const meta = match?.[3] ?? "";
  const ahead = Number(meta.match(/ahead\s+(\d+)/)?.[1] ?? 0);
  const behind = Number(meta.match(/behind\s+(\d+)/)?.[1] ?? 0);
  return { branch, upstream, ahead, behind };
}

function parseStatusFiles(stdout: string): GitFileStatus[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("##"))
    .map((line) => {
      const index = line[0] ?? " ";
      const workingTree = line[1] ?? " ";
      const rawPath = normalizeGitPath(line.slice(3));
      const renamed = index === "R" || workingTree === "R";
      const [originalPath, currentPath] = renamed ? rawPath.split(" -> ") : [undefined, rawPath];
      const targetPath = currentPath ?? rawPath;
      return {
        path: normalizeGitPath(targetPath),
        originalPath: originalPath ? normalizeGitPath(originalPath) : undefined,
        index,
        workingTree,
        staged: index !== " " && index !== "?",
        unstaged: workingTree !== " " && workingTree !== "?",
        untracked: index === "?" && workingTree === "?",
        deleted: index === "D" || workingTree === "D",
        renamed
      };
    });
}

function remoteSyncState(upstream: string | undefined, ahead: number, behind: number): RemoteSyncState {
  if (!upstream) {
    return "no-upstream";
  }
  if (ahead > 0 && behind > 0) {
    return "diverged";
  }
  if (ahead > 0) {
    return "ahead";
  }
  if (behind > 0) {
    return "behind";
  }
  return "synced";
}

function parseBranches(stdout: string): GitBranch[] {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [head, name, upstream] = line.split("|");
      return {
        name,
        current: head === "*",
        upstream: upstream || undefined
      };
    });
}

function parseRemotes(stdout: string): GitRemote[] {
  const map = new Map<string, GitRemote>();
  stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (!match) {
        return;
      }
      const [, name, url, kind] = match;
      const remote = map.get(name) ?? { name, fetchUrl: "", pushUrl: "" };
      if (kind === "fetch") {
        remote.fetchUrl = url;
      } else {
        remote.pushUrl = url;
      }
      map.set(name, remote);
    });
  return [...map.values()];
}

function parseLogs(stdout: string): GitLogEntry[] {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]+)\s+(?:\((.*?)\)\s+)?(.+)$/i);
      return {
        hash: match?.[1] ?? "",
        refs: match?.[2],
        message: match?.[3] ?? line
      };
    });
}

function parseGraphEntries(stdout: string, headSha: string, upstreamSha?: string): GitGraphEntry[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.includes("\x1f"))
    .map((line) => {
      const delimiter = line.indexOf("\x1f");
      const graph = line.slice(0, delimiter);
      const payload = line.slice(delimiter + 1);
      const [hash = "", shortHash = "", parents = "", refs = "", message = payload] = payload.split("\x1f");
      return {
        graph,
        hash,
        shortHash,
        parents: parents.split(" ").filter(Boolean),
        refs: refs || undefined,
        message,
        isHead: hash === headSha,
        isUpstream: Boolean(upstreamSha && hash === upstreamSha),
        isRemote: refs.split(", ").some((ref) => ref.startsWith("origin/") || ref.startsWith("upstream/"))
      };
    });
}

function resolvePushTarget(
  upstream: string,
  remotes: GitRemote[],
  branch: string
): { remoteName: string; remoteBranch: string } | null {
  if (upstream) {
    const remote = remotes
      .map((item) => item.name)
      .sort((a, b) => b.length - a.length)
      .find((name) => upstream === name || upstream.startsWith(`${name}/`));
    if (remote) {
      return {
        remoteName: remote,
        remoteBranch: upstream === remote ? branch : upstream.slice(remote.length + 1)
      };
    }
  }

  const origin = remotes.find((remote) => remote.name === "origin") ?? remotes[0];
  if (!origin) {
    return null;
  }
  return {
    remoteName: origin.name,
    remoteBranch: branch
  };
}

function parseLsRemoteHead(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .find(Boolean);
}

function decodeGitOutput(value: Buffer | string | undefined): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return utf8Decoder.decode(value);
}

function normalizeGitPath(rawPath: string): string {
  const value = rawPath.endsWith("\r") ? rawPath.slice(0, -1) : rawPath;
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  const unquoted = value.slice(1, -1);
  const bytes: number[] = [];
  let output = "";

  for (let index = 0; index < unquoted.length; index += 1) {
    const char = unquoted[index];
    if (char !== "\\") {
      flushBytes();
      output += char;
      continue;
    }

    const next = unquoted.slice(index + 1, index + 4);
    if (/^[0-7]{3}$/.test(next)) {
      bytes.push(Number.parseInt(next, 8));
      index += 3;
      continue;
    }

    flushBytes();
    const escaped = unquoted[index + 1];
    if (escaped === "t") {
      output += "\t";
    } else if (escaped === "n") {
      output += "\n";
    } else if (escaped === "r") {
      output += "\r";
    } else if (escaped) {
      output += escaped;
      index += 1;
    } else {
      output += "\\";
    }
  }

  flushBytes();
  return output;

  function flushBytes(): void {
    if (!bytes.length) {
      return;
    }
    output += utf8Decoder.decode(Buffer.from(bytes));
    bytes.length = 0;
  }
}
