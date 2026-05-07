import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type {
  EffectiveLanguage,
  GithubBrowserLoginResult,
  GithubDeviceFlowStart,
  GithubLoginStatus,
  PullRequestInput,
  PullRequestResult,
  Project
} from "../shared/types";
import { serverMessage } from "../shared/serverMessages";

const execFileAsync = promisify(execFile);

type GitHubRepo = {
  owner: string;
  repo: string;
};

export class GithubService {
  constructor(
    private readonly getToken: () => string | null,
    private readonly getLanguage: () => EffectiveLanguage
  ) {}

  async getLoginStatus(): Promise<GithubLoginStatus> {
    const token = await this.getEffectiveToken();
    if (!token) {
      const gcmAccount = await this.getCredentialManagerAccount();
      return gcmAccount ? { state: "signed-in", login: gcmAccount } : { state: "missing" };
    }

    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "Gitool"
        }
      });

      const payload = (await response.json()) as {
        login?: string;
        name?: string;
        avatar_url?: string;
        html_url?: string;
        message?: string;
      };

      if (!response.ok || !payload.login) {
        return {
          state: "invalid",
          message: payload.message || `${this.message("githubStatusFailed")}: HTTP ${response.status}`
        };
      }

      return {
        state: "signed-in",
        login: payload.login,
        name: payload.name,
        avatarUrl: payload.avatar_url,
        htmlUrl: payload.html_url
      };
    } catch (error) {
      return {
        state: "invalid",
        message: error instanceof Error ? error.message : this.message("githubStatusFailed")
      };
    }
  }

  async loginWithCredentialManager(): Promise<GithubBrowserLoginResult> {
    try {
      await execFileAsync("git", ["credential-manager", "github", "login"], {
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 2,
        timeout: 1000 * 60 * 5
      });
      return {
        ok: true,
        status: await this.getLoginStatus()
      };
    } catch (error) {
      return {
        ok: false,
        status: await this.getLoginStatus(),
        message: error instanceof Error ? error.message : this.message("githubOAuthTokenFailed")
      };
    }
  }

  async startDeviceFlow(clientId: string): Promise<GithubDeviceFlowStart> {
    if (!clientId.trim()) {
      throw new Error(this.message("githubOAuthClientIdRequired"));
    }

    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Gitool"
      },
      body: new URLSearchParams({
        client_id: clientId.trim(),
        scope: "repo read:user user:email"
      })
    });

    const payload = (await response.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !payload.device_code || !payload.user_code || !payload.verification_uri) {
      throw new Error(payload.error_description || payload.error || `${this.message("githubOAuthStartFailed")}: HTTP ${response.status}`);
    }

    return {
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      verificationUriComplete: payload.verification_uri_complete,
      expiresIn: payload.expires_in ?? 900,
      interval: payload.interval ?? 5
    };
  }

  async pollDeviceFlow(clientId: string, deviceCode: string): Promise<{ state: "authorized" | "pending" | "slow-down" | "expired" | "error"; accessToken?: string; message?: string }> {
    if (!clientId.trim()) {
      throw new Error(this.message("githubOAuthClientIdRequired"));
    }

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Gitool"
      },
      body: new URLSearchParams({
        client_id: clientId.trim(),
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });

    const payload = (await response.json()) as {
      access_token?: string;
      error?: "authorization_pending" | "slow_down" | "expired_token" | string;
      error_description?: string;
    };

    if (payload.access_token) {
      return { state: "authorized", accessToken: payload.access_token };
    }
    if (payload.error === "authorization_pending") {
      return { state: "pending", message: payload.error_description };
    }
    if (payload.error === "slow_down") {
      return { state: "slow-down", message: payload.error_description };
    }
    if (payload.error === "expired_token") {
      return { state: "expired", message: payload.error_description };
    }
    return {
      state: "error",
      message: payload.error_description || payload.error || `${this.message("githubOAuthTokenFailed")}: HTTP ${response.status}`
    };
  }

  async createPullRequest(project: Project, input: PullRequestInput, remoteUrl?: string): Promise<PullRequestResult> {
    const token = await this.getEffectiveToken();
    if (!token) {
      throw new Error(this.message("tokenRequired"));
    }

    const repo = parseGithubRemote(remoteUrl);
    if (!repo) {
      throw new Error(this.message("githubRemoteMissing"));
    }

    const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Gitool"
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        base: input.base,
        head: input.head
      })
    });

    const payload = (await response.json()) as { html_url?: string; number?: number; message?: string };
    if (!response.ok || !payload.html_url || !payload.number) {
      throw new Error(payload.message || `${this.message("githubPrFailed")}: HTTP ${response.status}`);
    }

    return {
      htmlUrl: payload.html_url,
      number: payload.number
    };
  }

  private message(key: Parameters<typeof serverMessage>[1]): string {
    return serverMessage(this.getLanguage(), key);
  }

  private async getEffectiveToken(): Promise<string | null> {
    return this.getToken() || (await this.getCredentialManagerToken());
  }

  private async getCredentialManagerAccount(): Promise<string | null> {
    try {
      const result = await execFileAsync("git", ["credential-manager", "github", "list"], {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      return result.stdout
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null;
    } catch {
      return null;
    }
  }

  private async getCredentialManagerToken(): Promise<string | null> {
    try {
      const output = await runGitCredentialManagerGet("protocol=https\nhost=github.com\n\n");
      const password = output
        .split(/\r?\n/)
        .find((line) => line.startsWith("password="))
        ?.slice("password=".length)
        .trim();
      return password || null;
    } catch {
      return null;
    }
  }
}

function runGitCredentialManagerGet(input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["credential-manager", "get"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
      } else {
        reject(new Error(Buffer.concat(stderr).toString("utf8") || `git credential-manager get exited with ${code}`));
      }
    });
    child.stdin.end(input);
  });
}

function parseGithubRemote(remoteUrl?: string): GitHubRepo | null {
  if (!remoteUrl) {
    return null;
  }

  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2]
    };
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2]
    };
  }

  return null;
}
