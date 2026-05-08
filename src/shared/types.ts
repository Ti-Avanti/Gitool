export type Project = {
  id: string;
  name: string;
  path: string;
  favorite: boolean;
  lastOpenedAt: string;
};

export type ProjectInput = {
  path: string;
  name?: string;
};

export type GitRemote = {
  name: string;
  fetchUrl: string;
  pushUrl: string;
};

export type GitFileStatus = {
  path: string;
  originalPath?: string;
  index: string;
  workingTree: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  deleted: boolean;
  renamed: boolean;
};

export type GitBranch = {
  name: string;
  current: boolean;
  upstream?: string;
};

export type GitLogEntry = {
  hash: string;
  message: string;
  refs?: string;
};

export type GitGraphEntry = {
  graph: string;
  hash: string;
  shortHash: string;
  parents: string[];
  message: string;
  refs?: string;
  isHead: boolean;
  isUpstream: boolean;
  isRemote: boolean;
};

export type RemoteSyncState = "synced" | "ahead" | "behind" | "diverged" | "no-upstream" | "unknown";

export type GitSnapshot = {
  projectId: string;
  branch: string;
  upstream?: string;
  headSha: string;
  upstreamSha?: string;
  remoteSync: RemoteSyncState;
  ahead: number;
  behind: number;
  clean: boolean;
  files: GitFileStatus[];
  branches: GitBranch[];
  remotes: GitRemote[];
  logs: GitLogEntry[];
  graph: GitGraphEntry[];
  stashes: string[];
  tags: string[];
};

export type GitCommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  command: string;
};

export type LanguagePreference = "system" | "zh-CN" | "en-US";

export type EffectiveLanguage = Exclude<LanguagePreference, "system">;

export type AppSettings = {
  commitTemplate: string;
  pullMode: "ff-only" | "rebase" | "merge";
  language: LanguagePreference;
  githubOAuthClientId: string;
  effectiveLanguage: EffectiveLanguage;
  githubTokenConfigured: boolean;
};

export type PullMode = AppSettings["pullMode"];

export type ResetMode = "soft" | "mixed" | "hard";

export type GithubLoginStatus = {
  state: "missing" | "signed-in" | "invalid";
  login?: string;
  name?: string;
  avatarUrl?: string;
  htmlUrl?: string;
  message?: string;
};

export type GithubDeviceFlowStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
};

export type GithubDeviceFlowPollResult = {
  state: "authorized" | "pending" | "slow-down" | "expired" | "error";
  message?: string;
  settings?: AppSettings;
  status?: GithubLoginStatus;
};

export type GithubBrowserLoginResult = {
  ok: boolean;
  status: GithubLoginStatus;
  message?: string;
};

export type PullRequestInput = {
  projectId: string;
  title: string;
  body: string;
  base: string;
  head: string;
};

export type PullRequestResult = {
  htmlUrl: string;
  number: number;
};

export type BranchActionInput = {
  projectId: string;
  name: string;
  startPoint?: string;
};

export type TagActionInput = {
  projectId: string;
  name: string;
  message?: string;
};

export type RebaseInput = {
  projectId: string;
  target: string;
};

export type ResetCommitInput = {
  projectId: string;
  hash: string;
  mode: ResetMode;
};

export type GitoolApi = {
  getPathForFile: (file: unknown) => string;
  selectDirectory: () => Promise<string | null>;
  listProjects: () => Promise<Project[]>;
  addProject: (input: ProjectInput) => Promise<Project>;
  removeProject: (projectId: string) => Promise<Project[]>;
  revealProject: (projectId: string) => Promise<void>;
  openTerminal: (projectId: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<Omit<AppSettings, "githubTokenConfigured" | "effectiveLanguage">>) => Promise<AppSettings>;
  setGithubToken: (token: string) => Promise<AppSettings>;
  clearGithubToken: () => Promise<AppSettings>;
  getGithubStatus: () => Promise<GithubLoginStatus>;
  loginWithGithubBrowser: () => Promise<GithubBrowserLoginResult>;
  startGithubWebLogin: (clientId?: string) => Promise<GithubDeviceFlowStart>;
  pollGithubWebLogin: (deviceCode: string, clientId?: string) => Promise<GithubDeviceFlowPollResult>;
  getSnapshot: (projectId: string) => Promise<GitSnapshot>;
  getDiff: (projectId: string, path: string, staged: boolean) => Promise<string>;
  stageFiles: (projectId: string, paths: string[]) => Promise<GitCommandResult>;
  unstageFiles: (projectId: string, paths: string[]) => Promise<GitCommandResult>;
  commitFiles: (projectId: string, paths: string[], message: string) => Promise<GitCommandResult>;
  fetchProject: (projectId: string) => Promise<GitCommandResult>;
  pullProject: (projectId: string, mode: PullMode) => Promise<GitCommandResult>;
  pushProject: (projectId: string) => Promise<GitCommandResult>;
  createBranch: (input: BranchActionInput) => Promise<GitCommandResult>;
  switchBranch: (projectId: string, branch: string) => Promise<GitCommandResult>;
  deleteBranch: (projectId: string, branch: string) => Promise<GitCommandResult>;
  createStash: (projectId: string, message: string) => Promise<GitCommandResult>;
  applyStash: (projectId: string, stashRef: string) => Promise<GitCommandResult>;
  dropStash: (projectId: string, stashRef: string) => Promise<GitCommandResult>;
  createTag: (input: TagActionInput) => Promise<GitCommandResult>;
  deleteTag: (projectId: string, tag: string) => Promise<GitCommandResult>;
  rebaseOnto: (input: RebaseInput) => Promise<GitCommandResult>;
  resetToCommit: (input: ResetCommitInput) => Promise<GitCommandResult>;
  createPullRequest: (input: PullRequestInput) => Promise<PullRequestResult>;
};
