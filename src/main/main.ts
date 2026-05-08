import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { ConfigStore } from "./configStore";
import { GitService } from "./gitService";
import { GithubService } from "./githubService";
import { serverMessage } from "../shared/serverMessages";
import type {
  AppSettings,
  BranchActionInput,
  PullMode,
  PullRequestInput,
  RebaseInput,
  ResetCommitInput,
  TagActionInput
} from "../shared/types";

const configStore = new ConfigStore();
const gitService = new GitService(() => configStore.getEffectiveLanguage());
const githubService = new GithubService(
  () => configStore.getGithubToken(),
  () => configStore.getEffectiveLanguage()
);

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "Gitool",
    backgroundColor: "#f6f6f3",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
    return;
  }

  await mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
}

function project(projectId: string) {
  return configStore.getProject(projectId);
}

function registerIpc(): void {
  ipcMain.handle("dialog:select-directory", async () => {
    const options: OpenDialogOptions = {
      properties: ["openDirectory"],
      title: serverMessage(configStore.getEffectiveLanguage(), "selectProjectDirectory")
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("projects:list", () => configStore.listProjects());

  ipcMain.handle("projects:add", async (_event, input: { path: string; name?: string }) => {
    const repoPath = await gitService.resolveRepository(input.path);
    return configStore.addProject(input, repoPath);
  });

  ipcMain.handle("projects:remove", (_event, projectId: string) => configStore.removeProject(projectId));

  ipcMain.handle("projects:reveal", async (_event, projectId: string) => {
    await shell.openPath(project(projectId).path);
  });

  ipcMain.handle("projects:terminal", (_event, projectId: string) => {
    const repoPath = project(projectId).path;
    spawn("cmd.exe", ["/K", `cd /d "${repoPath}"`], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }).unref();
  });

  ipcMain.handle("settings:get", () => configStore.getSettings());

  ipcMain.handle("settings:save", (_event, settings: Partial<Omit<AppSettings, "githubTokenConfigured" | "effectiveLanguage">>) =>
    configStore.saveSettings(settings)
  );

  ipcMain.handle("github:set-token", (_event, token: string) => configStore.setGithubToken(token));
  ipcMain.handle("github:clear-token", async () => {
    const settings = await configStore.clearGithubToken();
    await githubService.logoutFromCredentialManager();
    return settings;
  });
  ipcMain.handle("github:status", () => githubService.getLoginStatus());
  ipcMain.handle("github:browser-login", () => githubService.loginWithCredentialManager());
  ipcMain.handle("github:web-login:start", async (_event, clientId?: string) => {
    const settings = configStore.getSettings();
    const resolvedClientId = clientId?.trim() || settings.githubOAuthClientId.trim();
    const flow = await githubService.startDeviceFlow(resolvedClientId);
    await shell.openExternal(flow.verificationUriComplete || flow.verificationUri);
    return flow;
  });
  ipcMain.handle("github:web-login:poll", async (_event, deviceCode: string, clientId?: string) => {
    const settings = configStore.getSettings();
    const resolvedClientId = clientId?.trim() || settings.githubOAuthClientId.trim();
    const result = await githubService.pollDeviceFlow(resolvedClientId, deviceCode);
    if (result.state !== "authorized" || !result.accessToken) {
      return result;
    }
    const nextSettings = await configStore.setGithubToken(result.accessToken);
    return {
      state: "authorized",
      settings: nextSettings,
      status: await githubService.getLoginStatus()
    };
  });

  ipcMain.handle("git:snapshot", (_event, projectId: string) => gitService.snapshot(project(projectId)));
  ipcMain.handle("git:diff", (_event, projectId: string, filePath: string, staged: boolean) =>
    gitService.diff(project(projectId), filePath, staged)
  );
  ipcMain.handle("git:stage", (_event, projectId: string, paths: string[]) => gitService.stage(project(projectId), paths));
  ipcMain.handle("git:unstage", (_event, projectId: string, paths: string[]) => gitService.unstage(project(projectId), paths));
  ipcMain.handle("git:commit", (_event, projectId: string, paths: string[], message: string) =>
    gitService.commit(project(projectId), paths, message)
  );
  ipcMain.handle("git:fetch", (_event, projectId: string) => gitService.fetch(project(projectId)));
  ipcMain.handle("git:pull", (_event, projectId: string, mode: PullMode) => gitService.pull(project(projectId), mode));
  ipcMain.handle("git:push", (_event, projectId: string) => gitService.push(project(projectId)));
  ipcMain.handle("git:branch:create", (_event, input: BranchActionInput) =>
    gitService.createBranch(project(input.projectId), input.name, input.startPoint)
  );
  ipcMain.handle("git:branch:switch", (_event, projectId: string, branch: string) =>
    gitService.switchBranch(project(projectId), branch)
  );
  ipcMain.handle("git:branch:merge", (_event, projectId: string, branch: string) =>
    gitService.mergeBranch(project(projectId), branch)
  );
  ipcMain.handle("git:branch:delete", (_event, projectId: string, branch: string) =>
    gitService.deleteBranch(project(projectId), branch)
  );
  ipcMain.handle("git:stash:create", (_event, projectId: string, message: string) =>
    gitService.createStash(project(projectId), message)
  );
  ipcMain.handle("git:stash:apply", (_event, projectId: string, stashRef: string) =>
    gitService.applyStash(project(projectId), stashRef)
  );
  ipcMain.handle("git:stash:drop", (_event, projectId: string, stashRef: string) =>
    gitService.dropStash(project(projectId), stashRef)
  );
  ipcMain.handle("git:tag:create", (_event, input: TagActionInput) =>
    gitService.createTag(project(input.projectId), input.name, input.message)
  );
  ipcMain.handle("git:tag:delete", (_event, projectId: string, tag: string) => gitService.deleteTag(project(projectId), tag));
  ipcMain.handle("git:rebase", (_event, input: RebaseInput) => gitService.rebaseOnto(project(input.projectId), input.target));
  ipcMain.handle("git:reset", (_event, input: ResetCommitInput) =>
    gitService.resetToCommit(project(input.projectId), input.hash, input.mode)
  );
  ipcMain.handle("github:pull-request", async (_event, input: PullRequestInput) => {
    const selectedProject = project(input.projectId);
    const snapshot = await gitService.snapshot(selectedProject);
    const origin = snapshot.remotes.find((remote) => remote.name === "origin") ?? snapshot.remotes[0];
    return githubService.createPullRequest(selectedProject, input, origin?.pushUrl || origin?.fetchUrl);
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await configStore.load();
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
