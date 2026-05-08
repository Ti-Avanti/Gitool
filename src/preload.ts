import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppSettings,
  BranchActionInput,
  GitoolApi,
  ProjectInput,
  PullMode,
  PullRequestInput,
  RebaseInput,
  ResetCommitInput,
  TagActionInput
} from "./shared/types";

const api: GitoolApi = {
  getPathForFile: (file: unknown) => webUtils.getPathForFile(file as File),
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  addProject: (input: ProjectInput) => ipcRenderer.invoke("projects:add", input),
  removeProject: (projectId: string) => ipcRenderer.invoke("projects:remove", projectId),
  revealProject: (projectId: string) => ipcRenderer.invoke("projects:reveal", projectId),
  openTerminal: (projectId: string) => ipcRenderer.invoke("projects:terminal", projectId),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Partial<Omit<AppSettings, "githubTokenConfigured" | "effectiveLanguage">>) =>
    ipcRenderer.invoke("settings:save", settings),
  setGithubToken: (token: string) => ipcRenderer.invoke("github:set-token", token),
  clearGithubToken: () => ipcRenderer.invoke("github:clear-token"),
  getGithubStatus: () => ipcRenderer.invoke("github:status"),
  loginWithGithubBrowser: () => ipcRenderer.invoke("github:browser-login"),
  startGithubWebLogin: (clientId?: string) => ipcRenderer.invoke("github:web-login:start", clientId),
  pollGithubWebLogin: (deviceCode: string, clientId?: string) => ipcRenderer.invoke("github:web-login:poll", deviceCode, clientId),
  getSnapshot: (projectId: string) => ipcRenderer.invoke("git:snapshot", projectId),
  getDiff: (projectId: string, filePath: string, staged: boolean) => ipcRenderer.invoke("git:diff", projectId, filePath, staged),
  stageFiles: (projectId: string, paths: string[]) => ipcRenderer.invoke("git:stage", projectId, paths),
  unstageFiles: (projectId: string, paths: string[]) => ipcRenderer.invoke("git:unstage", projectId, paths),
  commitFiles: (projectId: string, paths: string[], message: string) => ipcRenderer.invoke("git:commit", projectId, paths, message),
  fetchProject: (projectId: string) => ipcRenderer.invoke("git:fetch", projectId),
  pullProject: (projectId: string, mode: PullMode) => ipcRenderer.invoke("git:pull", projectId, mode),
  pushProject: (projectId: string) => ipcRenderer.invoke("git:push", projectId),
  createBranch: (input: BranchActionInput) => ipcRenderer.invoke("git:branch:create", input),
  switchBranch: (projectId: string, branch: string) => ipcRenderer.invoke("git:branch:switch", projectId, branch),
  mergeBranch: (projectId: string, branch: string) => ipcRenderer.invoke("git:branch:merge", projectId, branch),
  deleteBranch: (projectId: string, branch: string) => ipcRenderer.invoke("git:branch:delete", projectId, branch),
  createStash: (projectId: string, message: string) => ipcRenderer.invoke("git:stash:create", projectId, message),
  applyStash: (projectId: string, stashRef: string) => ipcRenderer.invoke("git:stash:apply", projectId, stashRef),
  dropStash: (projectId: string, stashRef: string) => ipcRenderer.invoke("git:stash:drop", projectId, stashRef),
  createTag: (input: TagActionInput) => ipcRenderer.invoke("git:tag:create", input),
  deleteTag: (projectId: string, tag: string) => ipcRenderer.invoke("git:tag:delete", projectId, tag),
  rebaseOnto: (input: RebaseInput) => ipcRenderer.invoke("git:rebase", input),
  resetToCommit: (input: ResetCommitInput) => ipcRenderer.invoke("git:reset", input),
  createPullRequest: (input: PullRequestInput) => ipcRenderer.invoke("github:pull-request", input)
};

contextBridge.exposeInMainWorld("gitool", api);
