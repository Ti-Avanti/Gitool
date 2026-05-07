import {
  Archive,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Github,
  GitBranch,
  GitCommit,
  GitPullRequest,
  History,
  KeyRound,
  Languages,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Split,
  Tags,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AppSettings,
  GitCommandResult,
  GitFileStatus,
  GitGraphEntry,
  GitSnapshot,
  GithubDeviceFlowStart,
  GithubLoginStatus,
  LanguagePreference,
  Project,
  PullMode,
  ResetMode
} from "../shared/types";
import { uiText } from "./i18n";

type Panel = "branch" | "stash" | "tag" | "rebase" | "pr" | "token" | "settings" | "history" | "more" | null;
type WorkspaceView = "graph" | "changes" | "sync";
type RunGitCommand = (title: string, action: () => Promise<GitCommandResult>, refresh?: boolean) => Promise<void>;
type GraphRefKind = "head" | "local" | "remote" | "tag";
type GraphRef = {
  label: string;
  kind: GraphRefKind;
  branchName?: string;
  remoteBranch?: string;
  current?: boolean;
  tracking?: boolean;
};

type OperationState = {
  title: string;
  body: string;
  tone: "idle" | "success" | "error";
};

const emptyOperation: OperationState = {
  title: "",
  body: "",
  tone: "idle"
};

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GitSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [githubStatus, setGithubStatus] = useState<GithubLoginStatus | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [showStagedDiff, setShowStagedDiff] = useState(false);
  const [diff, setDiff] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [view, setView] = useState<WorkspaceView>("graph");
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<OperationState>(emptyOperation);
  const refreshInFlight = useRef(false);
  const text = useMemo(() => uiText(settings?.effectiveLanguage ?? "zh-CN"), [settings?.effectiveLanguage]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return projects;
    }
    return projects.filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(keyword));
  }, [projects, query]);

  const snapshotSignature = useMemo(() => {
    if (!snapshot) {
      return "";
    }
    return [
      snapshot.headSha,
      snapshot.ahead,
      snapshot.behind,
      snapshot.remoteSync,
      ...snapshot.files.map((file) => `${file.index}${file.workingTree}:${file.path}`)
    ].join("\n");
  }, [snapshot]);

  const loadProjects = useCallback(async () => {
    const loaded = await window.gitool.listProjects();
    setProjects(loaded);
    setSelectedProjectId((current) => current ?? loaded[0]?.id ?? null);
  }, []);

  const loadSettings = useCallback(async () => {
    setSettings(await window.gitool.getSettings());
  }, []);

  const loadGithubStatus = useCallback(async () => {
    setGithubStatus(await window.gitool.getGithubStatus());
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!selectedProjectId) {
      setSnapshot(null);
      return;
    }
    if (refreshInFlight.current) {
      return;
    }
    refreshInFlight.current = true;
    try {
      const next = await window.gitool.getSnapshot(selectedProjectId);
      setSnapshot(next);
      setSelectedPaths((current) => new Set([...current].filter((item) => next.files.some((file) => file.path === item))));
      setFocusedPath((current) => current && next.files.some((file) => file.path === current) ? current : next.files[0]?.path ?? null);
    } finally {
      refreshInFlight.current = false;
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadProjects();
    void loadSettings();
    void loadGithubStatus();
  }, [loadGithubStatus, loadProjects, loadSettings]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    if (!selectedProjectId) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refreshSnapshot();
    }, 2500);
    const refreshOnFocus = () => {
      void refreshSnapshot();
      void loadGithubStatus();
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadGithubStatus, refreshSnapshot, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !focusedPath) {
      setDiff(text.diffPlaceholder);
      return;
    }
    window.gitool
      .getDiff(selectedProjectId, focusedPath, showStagedDiff)
      .then(setDiff)
      .catch((error: unknown) => setDiff(formatError(error)));
  }, [focusedPath, selectedProjectId, showStagedDiff, snapshotSignature, text]);

  useEffect(() => {
    if (settings?.commitTemplate && !commitMessage.trim()) {
      setCommitMessage(settings.commitTemplate);
    }
  }, [commitMessage, settings?.commitTemplate]);

  async function addProject() {
    const directory = await window.gitool.selectDirectory();
    if (!directory) {
      return;
    }
    await run(text.addProject, async () => {
      const project = await window.gitool.addProject({ path: directory });
      await loadProjects();
      setSelectedProjectId(project.id);
      setView("graph");
      return {
        ok: true,
        stdout: text.projectAdded(project.name, project.path),
        stderr: "",
        command: "add project"
      };
    });
  }

  async function removeProject(projectId: string) {
    if (!confirm(text.removeProjectConfirm)) {
      return;
    }
    await run(text.removeProject, async () => {
      const next = await window.gitool.removeProject(projectId);
      setProjects(next);
      setSelectedProjectId(next[0]?.id ?? null);
      return { ok: true, stdout: text.projectRemoved, stderr: "", command: "remove project" };
    }, false);
  }

  async function run(title: string, action: () => Promise<GitCommandResult>, refresh = true) {
    setBusy(true);
    setOperation({ title, body: text.running, tone: "idle" });
    try {
      const result = await action();
      setOperation({
        title: result.ok ? text.done(title) : text.failed(title),
        body: [result.command, result.stdout, result.stderr].filter(Boolean).join("\n\n"),
        tone: result.ok ? "success" : "error"
      });
      if (refresh) {
        await refreshSnapshot();
      }
    } catch (error) {
      setOperation({ title: text.failed(title), body: formatError(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function runSelected(title: string, action: (projectId: string, paths: string[]) => Promise<GitCommandResult>) {
    if (!selectedProjectId) {
      return;
    }
    await run(title, () => action(selectedProjectId, [...selectedPaths]));
  }

  async function commitSelected() {
    if (!selectedProjectId) {
      return;
    }
    await run(text.commit, () => window.gitool.commitFiles(selectedProjectId, [...selectedPaths], commitMessage));
    setCommitMessage(settings?.commitTemplate ?? "");
  }

  async function pull() {
    if (!selectedProjectId || !settings) {
      return;
    }
    if (!confirm(text.pullConfirm(text.pullMode(settings.pullMode)))) {
      return;
    }
    await run(text.pull, () => window.gitool.pullProject(selectedProjectId, settings.pullMode));
  }

  async function push() {
    if (!selectedProjectId) {
      return;
    }
    if (!confirm(text.pushConfirm)) {
      return;
    }
    await run(text.push, () => window.gitool.pushProject(selectedProjectId));
  }

  async function changeLanguage(language: LanguagePreference) {
    const next = await window.gitool.saveSettings({ language });
    setSettings(next);
  }

  function togglePath(filePath: string) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
    setFocusedPath(filePath);
  }

  const groupedFiles = useMemo(() => groupFiles(snapshot?.files ?? []), [snapshot?.files]);

  return (
    <div className="app-shell refactor-shell">
      <aside className="project-pane">
        <div className="brand">
          <div>
            <span className="brand-mark">G</span>
          </div>
          <div>
            <h1>Gitool</h1>
            <p>{text.subtitle}</p>
          </div>
        </div>

        <GitHubIdentity status={githubStatus} text={text} onOpenToken={() => setPanel("token")} />

        <button className="primary-action" onClick={addProject} disabled={busy}>
          <Plus size={17} />
          {text.addProject}
        </button>

        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.searchProject} />
        </label>

        <div className="project-list">
          {filteredProjects.map((project) => (
            <button
              key={project.id}
              className={`project-row ${project.id === selectedProjectId ? "active" : ""}`}
              onClick={() => {
                setSelectedProjectId(project.id);
                setView("graph");
              }}
            >
              <span className="project-glyph">
                <GitBranch size={15} />
              </span>
              <span className="project-name">{project.name}</span>
              <span className="project-path">{project.path}</span>
              {project.id === selectedProjectId && snapshot && (
                <span className="project-meta">{snapshot.branch} · {snapshot.clean ? text.clean : text.changes(snapshot.files.length)}</span>
              )}
              <ChevronRight size={16} />
            </button>
          ))}
          {!filteredProjects.length && <div className="empty-inline">{text.noProjects}</div>}
        </div>

        <div className="sidebar-footer">
          <div className="language-box compact-language">
            <div className="language-label">
              <Languages size={15} />
              <span>{text.language}</span>
            </div>
            <div className="language-actions">
              <button className={settings?.effectiveLanguage === "zh-CN" ? "active" : ""} onClick={() => changeLanguage("zh-CN")}>
                {text.chinese}
              </button>
              <button className={settings?.effectiveLanguage === "en-US" ? "active" : ""} onClick={() => changeLanguage("en-US")}>
                English
              </button>
            </div>
          </div>
          <button className="sidebar-settings" onClick={() => setPanel("settings")}>
            <Settings size={16} />
            {text.settings}
          </button>
        </div>
      </aside>

      <main className="workspace refactor-workspace">
        <header className="repo-header">
          <div>
            <p className="eyebrow">{text.currentProject}</p>
            <h2>{selectedProject?.name ?? text.noProjectSelected}</h2>
            <p className="path-line">{selectedProject?.path ?? text.addProjectStart}</p>
          </div>
          <div className="repo-actions">
            <span className="auto-refresh-pill">{text.autoRefresh}</span>
            <IconButton label={text.refresh} onClick={refreshSnapshot} disabled={!selectedProject || busy} icon={<RefreshCw size={17} />} />
            <IconButton label={text.revealProject} onClick={() => selectedProjectId && window.gitool.revealProject(selectedProjectId)} disabled={!selectedProject} icon={<FolderOpen size={17} />} />
            <CommandButton label={text.moreActions} icon={<MoreHorizontal size={16} />} onClick={() => setPanel("more")} />
          </div>
        </header>

        {selectedProject ? (
          <>
            <RepoSummary snapshot={snapshot} githubStatus={githubStatus} text={text} />
            <section className="workspace-tabs">
              <TabButton active={view === "graph"} icon={<GitBranch size={16} />} label={text.graphView} onClick={() => setView("graph")} />
              <TabButton active={view === "changes"} icon={<FileText size={16} />} label={text.changesView} onClick={() => setView("changes")} />
              <TabButton active={view === "sync"} icon={<Upload size={16} />} label={text.syncView} onClick={() => setView("sync")} />
              <div className="workspace-tab-actions">
                <CommandButton label={text.fetch} icon={<Download size={16} />} disabled={busy} onClick={() => selectedProjectId && run(text.fetch, () => window.gitool.fetchProject(selectedProjectId))} />
                <CommandButton label={text.pull} icon={<Download size={16} />} disabled={busy} onClick={pull} />
                <CommandButton label={text.push} icon={<Upload size={16} />} disabled={busy} onClick={push} />
              </div>
            </section>

            {view === "graph" && selectedProjectId && (
              <GraphWorkspace
                projectId={selectedProjectId}
                snapshot={snapshot}
                text={text}
                busy={busy}
                onRun={run}
              />
            )}
            {view === "changes" && (
              <ChangesWorkspace
                snapshot={snapshot}
                groupedFiles={groupedFiles}
                selectedPaths={selectedPaths}
                focusedPath={focusedPath}
                showStagedDiff={showStagedDiff}
                diff={diff}
                commitMessage={commitMessage}
                operation={operation}
                busy={busy}
                text={text}
                onTogglePath={togglePath}
                onFocusPath={setFocusedPath}
                onSelectAll={() => setSelectedPaths(new Set(snapshot?.files.map((file) => file.path) ?? []))}
                onClearSelection={() => setSelectedPaths(new Set())}
                onShowStagedDiff={setShowStagedDiff}
                onCommitMessage={setCommitMessage}
                onStage={() => runSelected(text.stageSelected, window.gitool.stageFiles)}
                onUnstage={() => runSelected(text.unstageSelected, window.gitool.unstageFiles)}
                onCommit={commitSelected}
                onRemoveProject={() => selectedProjectId && removeProject(selectedProjectId)}
              />
            )}
            {view === "sync" && (
              <SyncWorkspace
                snapshot={snapshot}
                settings={settings}
                githubStatus={githubStatus}
                busy={busy}
                text={text}
                onSettings={setSettings}
                onGithubStatus={setGithubStatus}
                onRun={run}
                onFetch={() => selectedProjectId && run(text.fetch, () => window.gitool.fetchProject(selectedProjectId))}
                onPull={pull}
                onPush={push}
              />
            )}
          </>
        ) : (
          <EmptyGuide text={text} onAddProject={addProject} busy={busy} />
        )}
      </main>

      {panel && (
        <ActionPanel
          panel={panel}
          snapshot={snapshot}
          settings={settings}
          projectId={selectedProjectId ?? ""}
          onClose={() => setPanel(null)}
          onRun={run}
          onSettings={setSettings}
          githubStatus={githubStatus}
          onGithubStatusChange={setGithubStatus}
          text={text}
          onPanelChange={setPanel}
        />
      )}
    </div>
  );
}

function RepoSummary({
  snapshot,
  githubStatus,
  text
}: {
  snapshot: GitSnapshot | null;
  githubStatus: GithubLoginStatus | null;
  text: ReturnType<typeof uiText>;
}) {
  return (
    <section className="repo-summary">
      <SummaryItem label={text.branch} value={snapshot?.branch ?? "-"} />
      <SummaryItem label={text.upstream} value={snapshot?.upstream ?? text.notSet} />
      <SummaryItem label={text.remoteSync} value={snapshot ? text.syncLabel(snapshot.remoteSync) : text.notSet} tone={snapshot?.remoteSync === "synced" ? "good" : "warn"} />
      <SummaryItem label={text.changedFiles} value={snapshot?.clean ? text.clean : text.changes(snapshot?.files.length ?? 0)} />
      <SummaryItem label={text.githubAccount} value={githubStatusText(text, githubStatus)} />
    </section>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className={`summary-item ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function GraphWorkspace({ snapshot, text }: { snapshot: GitSnapshot | null; text: ReturnType<typeof uiText> }) {
  const entries = snapshot?.graph ?? [];
  return (
    <section className="graph-workspace">
      <div className="graph-sidebar">
        <p className="eyebrow">{text.gitTree}</p>
        <h3>{snapshot ? text.syncLabel(snapshot.remoteSync) : text.projectStatusHint}</h3>
        <div className="graph-stat">
          <span>{text.gitTreeLocal}</span>
          <strong>{snapshot?.headSha ? shortSha(snapshot.headSha) : "-"}</strong>
        </div>
        <div className="graph-stat">
          <span>{text.gitTreeRemote}</span>
          <strong>{snapshot?.upstreamSha ? shortSha(snapshot.upstreamSha) : text.notSet}</strong>
        </div>
        <div className="graph-legend">
          <span><GitBranch size={14} /> {snapshot?.branch ?? "-"}</span>
          <span><Upload size={14} /> {snapshot?.upstream ?? text.notSet}</span>
        </div>
      </div>

      <div className="git-graph-panel">
        <div className="git-graph-head">
          <strong>{text.graphView}</strong>
          <span>{text.gitGraphHint}</span>
        </div>
        <div className="git-graph-list">
          {entries.map((entry, index) => (
            <div key={entry.hash || `${entry.message}-${index}`} className={`git-graph-row ${entry.isHead ? "head" : ""}`}>
              <code className="git-graph-lines">{entry.graph || "*"}</code>
              <code className="git-graph-sha">{entry.shortHash}</code>
              <div className="git-graph-message">
                <strong>{entry.message}</strong>
                <div className="graph-badges">
                  {entry.isHead && <span>{text.gitTreeHead}</span>}
                  {entry.isUpstream && <span>{snapshot?.upstream ?? text.gitTreeRemote}</span>}
                  {!entry.isUpstream && entry.isRemote && <span>{text.gitTreeRemote}</span>}
                  {entry.refs &&
                    entry.refs
                      .split(", ")
                      .filter((ref) => ref !== "HEAD" && ref !== snapshot?.upstream && ref !== `HEAD -> ${snapshot?.branch}`)
                      .slice(0, 3)
                      .map((ref) => <span key={ref}>{ref}</span>)}
                </div>
              </div>
            </div>
          ))}
          {!entries.length && <div className="empty-inline">{text.gitTreeEmpty}</div>}
        </div>
      </div>
    </section>
  );
}

function ChangesWorkspace({
  snapshot,
  groupedFiles,
  selectedPaths,
  focusedPath,
  showStagedDiff,
  diff,
  commitMessage,
  operation,
  busy,
  text,
  onTogglePath,
  onFocusPath,
  onSelectAll,
  onClearSelection,
  onShowStagedDiff,
  onCommitMessage,
  onStage,
  onUnstage,
  onCommit,
  onRemoveProject
}: {
  snapshot: GitSnapshot | null;
  groupedFiles: ReturnType<typeof groupFiles>;
  selectedPaths: Set<string>;
  focusedPath: string | null;
  showStagedDiff: boolean;
  diff: string;
  commitMessage: string;
  operation: OperationState;
  busy: boolean;
  text: ReturnType<typeof uiText>;
  onTogglePath: (path: string) => void;
  onFocusPath: (path: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onShowStagedDiff: (value: boolean) => void;
  onCommitMessage: (value: string) => void;
  onStage: () => void;
  onUnstage: () => void;
  onCommit: () => void;
  onRemoveProject: () => void;
}) {
  return (
    <section className="changes-workspace">
      <div className="changes-pane">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{text.changedFiles}</p>
            <h3>{text.selectedCount(selectedPaths.size)}</h3>
          </div>
          <div className="inline-actions">
            <button onClick={onSelectAll}>{text.selectAll}</button>
            <button onClick={onClearSelection}>{text.clear}</button>
          </div>
        </div>

        <FileGroup title={text.staged} files={groupedFiles.staged} selectedPaths={selectedPaths} focusedPath={focusedPath} onToggle={onTogglePath} onFocus={onFocusPath} text={text} />
        <FileGroup title={text.unstaged} files={groupedFiles.unstaged} selectedPaths={selectedPaths} focusedPath={focusedPath} onToggle={onTogglePath} onFocus={onFocusPath} text={text} />
        <FileGroup title={text.untracked} files={groupedFiles.untracked} selectedPaths={selectedPaths} focusedPath={focusedPath} onToggle={onTogglePath} onFocus={onFocusPath} text={text} />
        {!snapshot?.files.length && <div className="empty-inline">{text.clean}</div>}
      </div>

      <div className="diff-pane">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{text.diff}</p>
            <h3>{focusedPath ?? text.noFileSelected}</h3>
          </div>
          <div className="segmented">
            <button className={!showStagedDiff ? "active" : ""} onClick={() => onShowStagedDiff(false)}>{text.workingTree}</button>
            <button className={showStagedDiff ? "active" : ""} onClick={() => onShowStagedDiff(true)}>{text.stagedArea}</button>
          </div>
        </div>
        <pre className="diff-output">{diff}</pre>
      </div>

      <aside className="commit-pane">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{text.commitPanel}</p>
            <h3>{text.commitSelectedFiles}</h3>
          </div>
          <GitCommit size={18} />
        </div>
        <textarea value={commitMessage} onChange={(event) => onCommitMessage(event.target.value)} placeholder={text.commitMessage} />
        <div className="stack-actions">
          <button disabled={!selectedPaths.size || busy} onClick={onStage}>
            <Check size={16} />
            {text.stageSelected}
          </button>
          <button disabled={!selectedPaths.size || busy} onClick={onUnstage}>
            <X size={16} />
            {text.unstageSelected}
          </button>
          <button className="commit-button" disabled={!selectedPaths.size || !commitMessage.trim() || busy} onClick={onCommit}>
            <GitCommit size={16} />
            {text.commit}
          </button>
        </div>
        <CommandOutput operation={operation} text={text} />
        <button className="danger-text" onClick={onRemoveProject}>
          <Trash2 size={15} />
          {text.removeFromList}
        </button>
      </aside>
    </section>
  );
}

function SyncWorkspace({
  snapshot,
  settings,
  githubStatus,
  busy,
  text,
  onSettings,
  onGithubStatus,
  onFetch,
  onPull,
  onPush
}: {
  snapshot: GitSnapshot | null;
  settings: AppSettings | null;
  githubStatus: GithubLoginStatus | null;
  busy: boolean;
  text: ReturnType<typeof uiText>;
  onSettings: (settings: AppSettings) => void;
  onGithubStatus: (status: GithubLoginStatus) => void;
  onRun: (title: string, action: () => Promise<GitCommandResult>, refresh?: boolean) => Promise<void>;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
}) {
  const [clientId, setClientId] = useState(settings?.githubOAuthClientId ?? "");
  const [manualToken, setManualToken] = useState("");
  const [flow, setFlow] = useState<GithubDeviceFlowStart | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setClientId(settings?.githubOAuthClientId ?? "");
  }, [settings?.githubOAuthClientId]);

  async function saveClientId() {
    const next = await window.gitool.saveSettings({ githubOAuthClientId: clientId.trim() });
    onSettings(next);
    setMessage(text.oauthClientSaved);
  }

  async function startWebLogin() {
    setLoginBusy(true);
    setMessage(text.waitingForGithub);
    try {
      const result = await window.gitool.loginWithGithubBrowser();
      onGithubStatus(result.status);
      setMessage(result.ok ? text.githubLoginComplete : result.message ?? text.githubInvalid);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setLoginBusy(false);
    }
  }

  async function startOAuthLogin() {
    if (!clientId.trim()) {
      setMessage(text.oauthClientIdRequired);
      return;
    }
    setLoginBusy(true);
    setMessage(text.waitingForGithub);
    try {
      const nextSettings = await window.gitool.saveSettings({ githubOAuthClientId: clientId.trim() });
      onSettings(nextSettings);
      const nextFlow = await window.gitool.startGithubWebLogin(clientId.trim());
      setFlow(nextFlow);
      setMessage(text.githubDeviceCode(nextFlow.userCode));
      await pollWebLogin(nextFlow, clientId.trim());
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setLoginBusy(false);
    }
  }

  async function pollWebLogin(nextFlow: GithubDeviceFlowStart, resolvedClientId: string) {
    let interval = nextFlow.interval;
    const expiresAt = Date.now() + nextFlow.expiresIn * 1000;
    while (Date.now() < expiresAt) {
      await delay(interval * 1000);
      const result = await window.gitool.pollGithubWebLogin(nextFlow.deviceCode, resolvedClientId);
      if (result.state === "authorized" && result.settings && result.status) {
        onSettings(result.settings);
        onGithubStatus(result.status);
        setMessage(text.githubLoginComplete);
        return;
      }
      if (result.state === "slow-down") {
        interval += 5;
      }
      if (result.state === "expired") {
        setMessage(text.githubLoginExpired);
        return;
      }
      if (result.state === "error") {
        setMessage(result.message ?? text.githubInvalid);
        return;
      }
    }
    setMessage(text.githubLoginExpired);
  }

  async function saveManualToken() {
    const next = await window.gitool.setGithubToken(manualToken);
    onSettings(next);
    onGithubStatus(await window.gitool.getGithubStatus());
    setManualToken("");
    setMessage(text.tokenConfigured);
  }

  async function clearToken() {
    const next = await window.gitool.clearGithubToken();
    onSettings(next);
    onGithubStatus(await window.gitool.getGithubStatus());
    setMessage(text.tokenNotConfigured);
  }

  return (
    <section className="sync-workspace">
      <div className="sync-card account-card">
        <div className="sync-card-heading">
          <Github size={20} />
          <div>
            <p className="eyebrow">{text.githubAccount}</p>
            <h3>{githubStatusText(text, githubStatus)}</h3>
          </div>
        </div>
        <label>
          {text.oauthClientId}
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={text.oauthClientIdPlaceholder} />
        </label>
        <div className="button-row">
          <button onClick={saveClientId}>{text.saveClientId}</button>
          <button className="primary-inline" onClick={startWebLogin} disabled={loginBusy}>
            <ExternalLink size={16} />
            {text.loginWithBrowser}
          </button>
          <button onClick={startOAuthLogin} disabled={loginBusy || !clientId.trim()}>
            {text.oauthFallbackLogin}
          </button>
        </div>
        {flow && (
          <div className="device-code-box">
            <span>{text.deviceCode}</span>
            <strong>{flow.userCode}</strong>
            <small>{flow.verificationUri}</small>
          </div>
        )}
        <p className="muted">{message || text.webLoginHelp}</p>
      </div>

      <div className="sync-card">
        <div className="sync-card-heading">
          <Upload size={20} />
          <div>
            <p className="eyebrow">{text.remoteSync}</p>
            <h3>{snapshot ? text.syncLabel(snapshot.remoteSync) : text.notSet}</h3>
          </div>
        </div>
        <div className="sync-stats">
          <SummaryItem label={text.branch} value={snapshot?.branch ?? "-"} />
          <SummaryItem label={text.upstream} value={snapshot?.upstream ?? text.notSet} />
          <SummaryItem label={text.ahead} value={String(snapshot?.ahead ?? 0)} />
          <SummaryItem label={text.behind} value={String(snapshot?.behind ?? 0)} />
        </div>
        <div className="stack-actions sync-actions">
          <button disabled={busy} onClick={onFetch}>
            <Download size={16} />
            {text.fetch}
          </button>
          <button disabled={busy} onClick={onPull}>
            <Download size={16} />
            {text.pull}
          </button>
          <button className="commit-button" disabled={busy} onClick={onPush}>
            <Upload size={16} />
            {text.push}
          </button>
        </div>
      </div>

      <div className="sync-card">
        <div className="sync-card-heading">
          <KeyRound size={20} />
          <div>
            <p className="eyebrow">{text.manualTokenFallback}</p>
            <h3>{settings?.githubTokenConfigured ? text.tokenConfiguredShort : text.tokenNotConfigured}</h3>
          </div>
        </div>
        <label>
          {text.token}
          <input value={manualToken} onChange={(event) => setManualToken(event.target.value)} type="password" placeholder="github_pat_..." />
        </label>
        <div className="button-row">
          <button disabled={!manualToken.trim()} onClick={saveManualToken}>{text.saveToken}</button>
          <button onClick={clearToken}>{text.clearToken}</button>
        </div>
      </div>
    </section>
  );
}

function ActionPanel({
  panel,
  snapshot,
  settings,
  projectId,
  onClose,
  onRun,
  onSettings,
  githubStatus,
  onGithubStatusChange,
  text,
  onPanelChange
}: {
  panel: Exclude<Panel, null>;
  snapshot: GitSnapshot | null;
  settings: AppSettings | null;
  projectId: string;
  onClose: () => void;
  onRun: (title: string, action: () => Promise<GitCommandResult>, refresh?: boolean) => Promise<void>;
  onSettings: (settings: AppSettings) => void;
  githubStatus: GithubLoginStatus | null;
  onGithubStatusChange: (status: GithubLoginStatus) => void;
  text: ReturnType<typeof uiText>;
  onPanelChange: (panel: Panel) => void;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState(snapshot?.upstream?.replace(/^origin\//, "") || "main");
  const [head, setHead] = useState(snapshot?.branch ?? "");
  const [body, setBody] = useState("");
  const [pullMode, setPullMode] = useState<PullMode>(settings?.pullMode ?? "ff-only");
  const [commitTemplate, setCommitTemplate] = useState(settings?.commitTemplate ?? "");
  const [language, setLanguage] = useState<LanguagePreference>(settings?.language ?? "system");
  const [clientId, setClientId] = useState(settings?.githubOAuthClientId ?? "");

  const titleMap: Record<Exclude<Panel, null>, string> = {
    branch: text.branch,
    stash: text.stash,
    tag: text.tag,
    rebase: text.rebase,
    pr: text.pr,
    token: text.tokenTitle,
    settings: text.settings,
    history: text.history,
    more: text.moreActions
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <h3>{titleMap[panel]}</h3>
          <button className="icon-only" onClick={onClose} aria-label={text.close}>
            <X size={18} />
          </button>
        </header>

        {panel === "more" && (
          <div className="modal-content">
            <p className="muted">{text.advancedActions}</p>
            <div className="more-grid">
              <button onClick={() => onPanelChange("branch")}><GitBranch size={17} />{text.branch}</button>
              <button onClick={() => onPanelChange("stash")}><Archive size={17} />{text.stash}</button>
              <button onClick={() => onPanelChange("tag")}><Tags size={17} />{text.tag}</button>
              <button onClick={() => onPanelChange("rebase")}><Split size={17} />{text.rebase}</button>
              <button onClick={() => onPanelChange("pr")}><GitPullRequest size={17} />{text.pr}</button>
              <button onClick={() => onPanelChange("history")}><History size={17} />{text.history}</button>
              <button onClick={() => onPanelChange("token")}><KeyRound size={17} />{text.token}</button>
              <button onClick={() => onPanelChange("settings")}><Settings size={17} />{text.settings}</button>
            </div>
          </div>
        )}

        {panel === "branch" && (
          <div className="modal-content">
            <label>{text.branchName}<input value={name} onChange={(event) => setName(event.target.value)} placeholder="feature/workflow" /></label>
            <label>{text.startPoint}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={text.startPointPlaceholder} /></label>
            <button disabled={!name.trim()} onClick={() => onRun(text.createAndSwitch, () => window.gitool.createBranch({ projectId, name, startPoint: target }))}>{text.createAndSwitch}</button>
            <div className="list-block">
              {snapshot?.branches.map((branch) => (
                <div key={branch.name} className="mini-row">
                  <span>{branch.current ? "● " : ""}{branch.name}</span>
                  <div>
                    <button disabled={branch.current} onClick={() => onRun(text.switchBranch, () => window.gitool.switchBranch(projectId, branch.name))}>{text.switch}</button>
                    <button disabled={branch.current} onClick={() => confirm(text.deleteBranchConfirm) && onRun(text.deleteBranch, () => window.gitool.deleteBranch(projectId, branch.name))}>{text.delete}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {panel === "stash" && (
          <div className="modal-content">
            <label>{text.stashMessage}<input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={text.stashPlaceholder} /></label>
            <button onClick={() => onRun(text.createStash, () => window.gitool.createStash(projectId, message))}>{text.createStash}</button>
            <div className="list-block">
              {snapshot?.stashes.map((stash) => {
                const ref = stash.split(":")[0];
                return (
                  <div key={stash} className="mini-row">
                    <span>{stash}</span>
                    <div>
                      <button onClick={() => onRun(text.applyStash, () => window.gitool.applyStash(projectId, ref))}>{text.apply}</button>
                      <button onClick={() => confirm(text.deleteStashConfirm) && onRun(text.dropStash, () => window.gitool.dropStash(projectId, ref))}>{text.delete}</button>
                    </div>
                  </div>
                );
              })}
              {!snapshot?.stashes.length && <p className="muted">{text.noStashes}</p>}
            </div>
          </div>
        )}

        {panel === "tag" && (
          <div className="modal-content">
            <label>{text.tagName}<input value={name} onChange={(event) => setName(event.target.value)} placeholder="v1.0.0" /></label>
            <label>{text.tagMessage}<input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={text.optional} /></label>
            <button disabled={!name.trim()} onClick={() => onRun(text.createTag, () => window.gitool.createTag({ projectId, name, message }))}>{text.createTag}</button>
            <div className="list-block">
              {snapshot?.tags.map((tag) => (
                <div key={tag} className="mini-row">
                  <span>{tag}</span>
                  <button onClick={() => confirm(text.deleteTagConfirm) && onRun(text.deleteTag, () => window.gitool.deleteTag(projectId, tag))}>{text.delete}</button>
                </div>
              ))}
              {!snapshot?.tags.length && <p className="muted">{text.noTags}</p>}
            </div>
          </div>
        )}

        {panel === "rebase" && (
          <div className="modal-content">
            <label>{text.rebaseTarget}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={text.rebaseTargetPlaceholder} /></label>
            <button disabled={!target.trim()} onClick={() => confirm(text.rebaseConfirm) && onRun(text.rebase, () => window.gitool.rebaseOnto({ projectId, target }))}>{text.startRebase}</button>
          </div>
        )}

        {panel === "pr" && (
          <div className="modal-content">
            <label>{text.title}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={text.prTitle} /></label>
            <label>{text.base}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="main" /></label>
            <label>{text.head}<input value={head} onChange={(event) => setHead(event.target.value)} placeholder="feature/xxx" /></label>
            <label>{text.description}<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={text.prDescription} /></label>
            <button
              disabled={!name.trim() || !target.trim() || !head.trim()}
              onClick={() =>
                onRun(
                  text.createPr,
                  async () => {
                    const result = await window.gitool.createPullRequest({ projectId, title: name, body, base: target, head });
                    return { ok: true, stdout: `#${result.number}\n${result.htmlUrl}`, stderr: "", command: text.createPr };
                  },
                  false
                )
              }
            >
              {text.createPr}
            </button>
          </div>
        )}

        {panel === "token" && (
          <div className="modal-content">
            <label>{text.oauthClientId}<input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={text.oauthClientIdPlaceholder} /></label>
            <button
              onClick={async () => {
                const next = await window.gitool.saveSettings({ githubOAuthClientId: clientId.trim() });
                onSettings(next);
              }}
            >
              {text.saveClientId}
            </button>
            <div className="token-status">
              <span>{text.tokenStatus}</span>
              <strong>{githubStatusText(text, githubStatus)}</strong>
            </div>
            <button
              onClick={async () => {
                const next = await window.gitool.clearGithubToken();
                onSettings(next);
                onGithubStatusChange(await window.gitool.getGithubStatus());
              }}
            >
              {text.clearToken}
            </button>
          </div>
        )}

        {panel === "settings" && (
          <div className="modal-content">
            <label>{text.pullStrategy}<select value={pullMode} onChange={(event) => setPullMode(event.target.value as PullMode)}><option value="ff-only">{text.pullMode("ff-only")}</option><option value="rebase">{text.pullMode("rebase")}</option><option value="merge">{text.pullMode("merge")}</option></select></label>
            <label>{text.defaultCommitTemplate}<textarea value={commitTemplate} onChange={(event) => setCommitTemplate(event.target.value)} placeholder="feat: " /></label>
            <label>{text.language}<select value={language} onChange={(event) => setLanguage(event.target.value as LanguagePreference)}><option value="system">{text.followSystem}</option><option value="zh-CN">{text.chinese}</option><option value="en-US">{text.english}</option></select></label>
            {settings && <p className="muted">{text.effectiveLanguage(settings.effectiveLanguage === "zh-CN" ? text.chinese : text.english)}</p>}
            <button
              onClick={async () => {
                const next = await window.gitool.saveSettings({ pullMode, commitTemplate, language });
                onSettings(next);
                onClose();
              }}
            >
              {text.saveSettings}
            </button>
          </div>
        )}

        {panel === "history" && (
          <div className="modal-content">
            <div className="list-block">
              {snapshot?.logs.map((entry) => (
                <div key={entry.hash} className="log-row">
                  <code>{entry.hash}</code>
                  <span>{entry.refs ? `${entry.refs} ` : ""}{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GitHubIdentity({ status, text, onOpenToken }: { status: GithubLoginStatus | null; text: ReturnType<typeof uiText>; onOpenToken: () => void }) {
  const signedIn = status?.state === "signed-in" && Boolean(status.login);
  return (
    <button className={`github-identity ${status?.state ?? "checking"}`} onClick={onOpenToken}>
      <span className="github-avatar">{signedIn && status?.avatarUrl ? <img src={status.avatarUrl} alt="" /> : <Github size={17} />}</span>
      <span className="github-copy">
        <span>{text.githubAccount}</span>
        <strong>{githubStatusText(text, status)}</strong>
        <small>{signedIn ? text.githubManageToken : text.loginWithBrowser}</small>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}

function EmptyGuide({ text, onAddProject, busy }: { text: ReturnType<typeof uiText>; onAddProject: () => void; busy: boolean }) {
  return (
    <section className="empty-guide">
      <div className="guide-visual" aria-hidden="true">
        <div className="guide-step active"><Plus size={22} /><span>{text.guideAdd}</span></div>
        <div className="guide-connector" />
        <div className="guide-step"><GitBranch size={22} /><span>{text.graphView}</span></div>
        <div className="guide-connector" />
        <div className="guide-step"><GitCommit size={22} /><span>{text.guideCommit}</span></div>
        <div className="guide-connector" />
        <div className="guide-step"><Upload size={22} /><span>{text.guidePush}</span></div>
      </div>
      <div className="guide-copy">
        <h3>{text.guideTitle}</h3>
        <p>{text.guideSubtitle}</p>
        <button className="primary-action guide-action" onClick={onAddProject} disabled={busy}><Plus size={17} />{text.addProject}</button>
      </div>
    </section>
  );
}

function FileGroup({
  title,
  files,
  selectedPaths,
  focusedPath,
  onToggle,
  onFocus,
  text
}: {
  title: string;
  files: GitFileStatus[];
  selectedPaths: Set<string>;
  focusedPath: string | null;
  onToggle: (path: string) => void;
  onFocus: (path: string) => void;
  text: ReturnType<typeof uiText>;
}) {
  if (!files.length) {
    return null;
  }
  const tree = buildFileTree(files);
  return (
    <div className="file-group">
      <h4>{title}</h4>
      <div className="file-tree">
        {tree.children.map((node) => (
          <FileTreeNodeView key={node.path} node={node} depth={0} selectedPaths={selectedPaths} focusedPath={focusedPath} onToggle={onToggle} onFocus={onFocus} text={text} />
        ))}
      </div>
    </div>
  );
}

type FileTreeNode = {
  name: string;
  path: string;
  count: number;
  file?: GitFileStatus;
  children: FileTreeNode[];
  childMap: Map<string, FileTreeNode>;
};

function FileTreeNodeView({
  node,
  depth,
  selectedPaths,
  focusedPath,
  onToggle,
  onFocus,
  text
}: {
  node: FileTreeNode;
  depth: number;
  selectedPaths: Set<string>;
  focusedPath: string | null;
  onToggle: (path: string) => void;
  onFocus: (path: string) => void;
  text: ReturnType<typeof uiText>;
}) {
  if (node.file) {
    const file = node.file;
    return (
      <div className={`file-row tree-file ${focusedPath === file.path ? "focused" : ""}`} style={{ paddingLeft: depth * 14 }}>
        <input type="checkbox" checked={selectedPaths.has(file.path)} onChange={() => onToggle(file.path)} />
        <button onClick={() => onFocus(file.path)}>
          <FileText size={14} />
          <span className={`status-code ${file.untracked ? "new" : file.deleted ? "deleted" : ""}`}>{file.untracked ? "??" : `${file.index}${file.workingTree}`}</span>
          <span>{file.renamed && file.originalPath ? `${file.originalPath} -> ${file.path}` : node.name}</span>
        </button>
      </div>
    );
  }

  return (
    <details className="tree-folder" open style={{ marginLeft: depth * 14 }}>
      <summary><Folder size={15} /><span>{node.name}</span><small>{text.folderCount(node.count)}</small></summary>
      <div>
        {node.children.map((child) => (
          <FileTreeNodeView key={child.path} node={child} depth={depth + 1} selectedPaths={selectedPaths} focusedPath={focusedPath} onToggle={onToggle} onFocus={onFocus} text={text} />
        ))}
      </div>
    </details>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`tab-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function IconButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
  return <button className="icon-button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>{icon}</button>;
}

function CommandButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
  return <button className="command-button" disabled={disabled} onClick={onClick}>{icon}{label}</button>;
}

function CommandOutput({ operation, text }: { operation: OperationState; text: ReturnType<typeof uiText> }) {
  return (
    <div className={`command-output ${operation.tone}`}>
      <strong>{operation.title || text.commandOutput}</strong>
      <pre>{operation.body || text.waiting}</pre>
    </div>
  );
}

function buildFileTree(files: GitFileStatus[]): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", count: files.length, children: [], childMap: new Map() };
  [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((file) => {
      const segments = file.path.split(/[\\/]+/).filter(Boolean);
      let cursor = root;
      let currentPath = "";
      segments.forEach((segment, index) => {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const isFile = index === segments.length - 1;
        const existing = cursor.childMap.get(segment);
        if (existing) {
          existing.count += 1;
          cursor = existing;
          return;
        }
        const node: FileTreeNode = { name: segment, path: currentPath, count: 1, file: isFile ? file : undefined, children: [], childMap: new Map() };
        cursor.childMap.set(segment, node);
        cursor.children.push(node);
        cursor = node;
      });
    });
  sortTree(root);
  return root;
}

function sortTree(node: FileTreeNode): void {
  node.children.sort((a, b) => {
    if (Boolean(a.file) !== Boolean(b.file)) {
      return a.file ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

function githubStatusText(text: ReturnType<typeof uiText>, status: GithubLoginStatus | null): string {
  if (!status) {
    return text.githubChecking;
  }
  if (status.state === "signed-in" && status.login) {
    return text.githubSignedIn(status.login);
  }
  if (status.state === "invalid") {
    return status.message ? `${text.githubInvalid}: ${status.message}` : text.githubInvalid;
  }
  return text.githubMissing;
}

function shortSha(value: string): string {
  return value.slice(0, 7);
}

function groupFiles(files: GitFileStatus[]) {
  return {
    staged: files.filter((file) => file.staged),
    unstaged: files.filter((file) => file.unstaged && !file.untracked),
    untracked: files.filter((file) => file.untracked)
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
