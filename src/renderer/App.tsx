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
import type { DragEvent, ReactNode } from "react";
import type {
  AppSettings,
  GitCommandResult,
  GitFileStatus,
  GitGraphEntry,
  GitSnapshot,
  GithubLoginStatus,
  LanguagePreference,
  Project,
  PullMode,
  ResetMode
} from "../shared/types";
import { uiText } from "./i18n";

type Panel = "branch" | "merge" | "stash" | "tag" | "rebase" | "pr" | "token" | "settings" | "history" | "more" | null;
type WorkspaceView = "graph" | "changes" | "sync";
type RunGitCommand = (title: string, action: () => Promise<GitCommandResult>, refresh?: boolean) => Promise<void>;
type RemoteCheckState = "idle" | "checking" | "error";
type RefreshSnapshotOptions = {
  force?: boolean;
};
type RefreshSnapshotInFlight = {
  projectId: string;
  promise: Promise<GitSnapshot | null>;
};
type GraphRefKind = "head" | "local" | "remote" | "tag";
type GraphRef = {
  label: string;
  kind: GraphRefKind;
  branchName?: string;
  remoteBranch?: string;
  current?: boolean;
  tracking?: boolean;
};
type GraphRefAction = "primary" | "merge";
type CommitGraphNode = {
  entry: GitGraphEntry;
  lane: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
type CommitGraphEdge = {
  from: CommitGraphNode;
  to: CommitGraphNode;
};
type CommitGraphLayout = {
  nodes: CommitGraphNode[];
  edges: CommitGraphEdge[];
  width: number;
  height: number;
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

const LOCAL_REFRESH_INTERVAL_MS = 10_000;
const REMOTE_CHECK_INTERVAL_MS = 300_000;

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
  const [draggingProject, setDraggingProject] = useState(false);
  const [remoteCheckState, setRemoteCheckState] = useState<RemoteCheckState>("idle");
  const [windowActive, setWindowActive] = useState(() => document.hasFocus() && document.visibilityState === "visible");
  const [mergeSourceHint, setMergeSourceHint] = useState("");
  const refreshInFlight = useRef<RefreshSnapshotInFlight | null>(null);
  const remoteCheckInFlight = useRef(false);
  const lastRemoteNoticeKey = useRef("");
  const selectedProjectIdRef = useRef<string | null>(null);
  const projectDragDepth = useRef(0);
  const text = useMemo(() => uiText(settings?.effectiveLanguage ?? "zh-CN"), [settings?.effectiveLanguage]);
  selectedProjectIdRef.current = selectedProjectId;

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

  const openMergePanel = useCallback((sourceBranch = "") => {
    setMergeSourceHint(sourceBranch);
    setPanel("merge");
  }, []);

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

  const applySnapshot = useCallback((next: GitSnapshot) => {
    setSnapshot(next);
    setSelectedPaths((current) => new Set([...current].filter((item) => next.files.some((file) => file.path === item))));
    setFocusedPath((current) => current && next.files.some((file) => file.path === current) ? current : next.files[0]?.path ?? null);
  }, []);

  const refreshSnapshot = useCallback(async (options: RefreshSnapshotOptions = {}) => {
    if (!selectedProjectId) {
      setSnapshot(null);
      return null;
    }
    const activeRefresh = refreshInFlight.current;
    if (activeRefresh) {
      if (activeRefresh.projectId === selectedProjectId && !options.force) {
        return activeRefresh.promise;
      }
      await activeRefresh.promise.catch(() => null);
      if (selectedProjectIdRef.current !== selectedProjectId) {
        return null;
      }
    }
    const projectId = selectedProjectId;
    const refresh = window.gitool.getSnapshot(projectId).then((next) => {
      if (selectedProjectIdRef.current !== projectId) {
        return null;
      }
      applySnapshot(next);
      return next;
    });
    refreshInFlight.current = { projectId, promise: refresh };
    try {
      return await refresh;
    } finally {
      if (refreshInFlight.current?.promise === refresh) {
        refreshInFlight.current = null;
      }
    }
  }, [applySnapshot, selectedProjectId]);

  const announceRemoteStatus = useCallback((next: GitSnapshot) => {
    if (next.remoteSync !== "behind" && next.remoteSync !== "diverged") {
      lastRemoteNoticeKey.current = "";
      return;
    }
    const noticeKey = [next.projectId, next.remoteSync, next.headSha, next.upstreamSha, next.ahead, next.behind].join(":");
    if (noticeKey === lastRemoteNoticeKey.current) {
      return;
    }
    lastRemoteNoticeKey.current = noticeKey;
    setOperation({
      title: next.remoteSync === "diverged" ? text.remoteDivergedTitle : text.remoteBehindTitle,
      body: next.remoteSync === "diverged"
        ? text.remoteDivergedBody(next.ahead, next.behind)
        : text.remoteBehindBody(next.behind),
      tone: "idle"
    });
  }, [text]);

  const checkRemoteUpdates = useCallback(async () => {
    if (!selectedProjectId || busy || remoteCheckInFlight.current) {
      return;
    }
    remoteCheckInFlight.current = true;
    setRemoteCheckState("checking");
    try {
      const result = await window.gitool.fetchProject(selectedProjectId);
      if (selectedProjectIdRef.current !== selectedProjectId) {
        return;
      }
      if (!result.ok) {
        setRemoteCheckState("error");
        setOperation({
          title: text.remoteAutoCheckFailed,
          body: [result.command, result.stdout, result.stderr].filter(Boolean).join("\n\n"),
          tone: "error"
        });
        return;
      }
      const next = await window.gitool.getSnapshot(selectedProjectId);
      if (selectedProjectIdRef.current !== selectedProjectId) {
        return;
      }
      applySnapshot(next);
      announceRemoteStatus(next);
      setRemoteCheckState("idle");
    } catch (error) {
      setRemoteCheckState("error");
      setOperation({ title: text.remoteAutoCheckFailed, body: formatError(error), tone: "error" });
    } finally {
      remoteCheckInFlight.current = false;
    }
  }, [announceRemoteStatus, applySnapshot, busy, selectedProjectId, text]);

  useEffect(() => {
    void loadProjects();
    void loadSettings();
    void loadGithubStatus();
  }, [loadGithubStatus, loadProjects, loadSettings]);

  useEffect(() => {
    const updateWindowActive = () => {
      setWindowActive(document.hasFocus() && document.visibilityState === "visible");
    };
    window.addEventListener("focus", updateWindowActive);
    window.addEventListener("blur", updateWindowActive);
    document.addEventListener("visibilitychange", updateWindowActive);
    updateWindowActive();
    return () => {
      window.removeEventListener("focus", updateWindowActive);
      window.removeEventListener("blur", updateWindowActive);
      document.removeEventListener("visibilitychange", updateWindowActive);
    };
  }, []);

  useEffect(() => {
    if (!windowActive) {
      return;
    }
    void refreshSnapshot();
    void loadGithubStatus();
  }, [loadGithubStatus, refreshSnapshot, windowActive]);

  useEffect(() => {
    if (!selectedProjectId || !windowActive) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refreshSnapshot();
    }, LOCAL_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshSnapshot, selectedProjectId, windowActive]);

  useEffect(() => {
    if (!selectedProjectId || !windowActive) {
      setRemoteCheckState("idle");
      return undefined;
    }
    lastRemoteNoticeKey.current = "";
    const timer = window.setInterval(() => {
      void checkRemoteUpdates();
    }, REMOTE_CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [checkRemoteUpdates, selectedProjectId, windowActive]);

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

  async function importProjectPath(projectPath: string, command: string) {
    await run(text.addProject, async () => {
      const project = await window.gitool.addProject({ path: projectPath });
      await loadProjects();
      setSelectedProjectId(project.id);
      setView("graph");
      return {
        ok: true,
        stdout: text.projectAdded(project.name, project.path),
        stderr: "",
        command
      };
    });
  }

  async function addProject() {
    const directory = await window.gitool.selectDirectory();
    if (!directory) {
      return;
    }
    await importProjectPath(directory, "add project");
  }

  function hasFileDrag(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleProjectDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    projectDragDepth.current += 1;
    setDraggingProject(true);
  }

  function handleProjectDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleProjectDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    projectDragDepth.current = Math.max(0, projectDragDepth.current - 1);
    if (projectDragDepth.current === 0) {
      setDraggingProject(false);
    }
  }

  async function handleProjectDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    projectDragDepth.current = 0;
    setDraggingProject(false);

    const file = event.dataTransfer.files.item(0);
    const projectPath = file ? window.gitool.getPathForFile(file) : "";
    if (!projectPath) {
      setOperation({ title: text.failed(text.addProject), body: text.dropProjectUnavailable, tone: "error" });
      return;
    }
    await importProjectPath(projectPath, "drop project");
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
        await refreshSnapshot({ force: true });
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
    const riskMessage = snapshot ? pullRiskMessage(snapshot, settings.pullMode, text) : "";
    const confirmMessage = riskMessage
      ? text.pullRiskConfirm(text.pullMode(settings.pullMode), riskMessage)
      : text.pullConfirm(text.pullMode(settings.pullMode));
    if (!confirm(confirmMessage)) {
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

  async function switchBranchSafely(branchName: string) {
    if (!selectedProjectId) {
      return;
    }
    const latestSnapshot = await refreshSnapshot({ force: true }) ?? snapshot;
    if (latestSnapshot && !latestSnapshot.clean) {
      setPanel("stash");
      setView("changes");
      setOperation({
        title: text.switchBranchBlockedTitle,
        body: text.switchBranchBlockedBody(latestSnapshot.branch, branchName, latestSnapshot.files.length),
        tone: "error"
      });
      return;
    }
    await run(text.switchBranch, () => window.gitool.switchBranch(selectedProjectId, branchName));
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
    <div
      className={`app-shell refactor-shell${draggingProject ? " is-project-dragging" : ""}`}
      onDragEnter={handleProjectDragEnter}
      onDragOver={handleProjectDragOver}
      onDragLeave={handleProjectDragLeave}
      onDrop={handleProjectDrop}
    >
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
            <span className={`auto-refresh-pill ${remoteCheckState}`}>{text.autoRefreshCloud(remoteCheckState)}</span>
            <IconButton label={text.refresh} onClick={refreshSnapshot} disabled={!selectedProject || busy} icon={<RefreshCw size={17} />} />
            <IconButton label={text.revealProject} onClick={() => selectedProjectId && window.gitool.revealProject(selectedProjectId)} disabled={!selectedProject} icon={<FolderOpen size={17} />} />
            <CommandButton label={text.moreActions} icon={<MoreHorizontal size={16} />} onClick={() => setPanel("more")} />
          </div>
        </header>

        {selectedProject ? (
          <>
            <RepoSummary snapshot={snapshot} githubStatus={githubStatus} text={text} />
            <RemoteUpdateBanner snapshot={snapshot} text={text} />
            <section className="workspace-tabs">
              <TabButton active={view === "graph"} icon={<GitBranch size={16} />} label={text.graphView} onClick={() => setView("graph")} />
              <TabButton active={view === "changes"} icon={<FileText size={16} />} label={text.changesView} onClick={() => setView("changes")} />
              <TabButton active={view === "sync"} icon={<Upload size={16} />} label={text.syncView} onClick={() => setView("sync")} />
              <div className="workspace-tab-actions">
                <CommandButton label={text.mergeBranch} icon={<Split size={16} />} disabled={!selectedProject || busy} onClick={() => openMergePanel()} />
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
                onSwitchBranch={switchBranchSafely}
                onOpenMergeBranch={openMergePanel}
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
                githubStatus={githubStatus}
                busy={busy}
                text={text}
                operation={operation}
                onFetch={() => selectedProjectId && run(text.fetch, () => window.gitool.fetchProject(selectedProjectId))}
                onPull={pull}
                onPush={push}
                onOpenToken={() => setPanel("token")}
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
          operation={operation}
          projectId={selectedProjectId ?? ""}
          mergeSourceHint={mergeSourceHint}
          onClose={() => setPanel(null)}
          onRun={run}
          onSwitchBranch={switchBranchSafely}
          onSettings={setSettings}
          githubStatus={githubStatus}
          onGithubStatusChange={setGithubStatus}
          text={text}
          onPanelChange={setPanel}
        />
      )}

      {draggingProject && (
        <div className="project-drop-overlay" aria-hidden="true">
          <div>
            <FolderOpen size={30} />
            <strong>{text.dropProjectTitle}</strong>
            <span>{text.dropProjectHint}</span>
          </div>
        </div>
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
      <SummaryItem label={text.currentBranch} value={snapshot?.branch ?? "-"} />
      <SummaryItem label={text.upstream} value={snapshot?.upstream ?? text.notSet} />
      <SummaryItem label={text.remoteSync} value={snapshot ? text.syncLabel(snapshot.remoteSync) : text.notSet} tone={snapshot?.remoteSync === "synced" ? "good" : "warn"} />
      <SummaryItem label={text.changedFiles} value={snapshot?.clean ? text.clean : text.changes(snapshot?.files.length ?? 0)} />
      <SummaryItem label={text.githubAccount} value={githubStatusText(text, githubStatus)} />
    </section>
  );
}

function RemoteUpdateBanner({ snapshot, text }: { snapshot: GitSnapshot | null; text: ReturnType<typeof uiText> }) {
  if (!snapshot || (snapshot.remoteSync !== "behind" && snapshot.remoteSync !== "diverged")) {
    return null;
  }
  const title = snapshot.remoteSync === "diverged" ? text.remoteDivergedTitle : text.remoteBehindTitle;
  const body = snapshot.remoteSync === "diverged"
    ? text.remoteDivergedBody(snapshot.ahead, snapshot.behind)
    : text.remoteBehindBody(snapshot.behind);

  return (
    <section className={`remote-update-banner ${snapshot.remoteSync}`}>
      <Download size={18} />
      <div>
        <strong>{title}</strong>
        <span>{snapshot.clean ? body : `${body} ${text.remoteLocalChangesHint}`}</span>
      </div>
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

function GraphWorkspace({
  projectId,
  snapshot,
  text,
  busy,
  onRun,
  onSwitchBranch,
  onOpenMergeBranch
}: {
  projectId: string;
  snapshot: GitSnapshot | null;
  text: ReturnType<typeof uiText>;
  busy: boolean;
  onRun: RunGitCommand;
  onSwitchBranch: (branchName: string) => Promise<void>;
  onOpenMergeBranch: (sourceBranch?: string) => void;
}) {
  const entries = useMemo(() => snapshot?.graph ?? [], [snapshot]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [hardConfirm, setHardConfirm] = useState("");

  useEffect(() => {
    if (!entries.length) {
      setSelectedHash(null);
      return;
    }
    if (!selectedHash || !entries.some((entry) => entry.hash === selectedHash)) {
      setSelectedHash(entries[0].hash);
    }
  }, [entries, selectedHash]);

  const selectedEntry = entries.find((entry) => entry.hash === selectedHash) ?? entries[0] ?? null;
  const selectedRefs = useMemo(() => (selectedEntry ? graphRefs(selectedEntry, snapshot) : []), [selectedEntry, snapshot]);

  function chooseEntry(entry: GitGraphEntry) {
    setSelectedHash(entry.hash);
    setHardConfirm("");
  }

  async function createBranchFromCommit() {
    if (!selectedEntry || !branchName.trim()) {
      return;
    }
    const name = branchName.trim();
    await onRun(text.createBranchHere, () => window.gitool.createBranch({ projectId, name, startPoint: selectedEntry.hash }));
    setBranchName("");
  }

  async function runRefAction(ref: GraphRef, action: GraphRefAction = "primary") {
    const branchName = ref.branchName;
    if (action === "merge" && ref.kind === "local" && branchName && !ref.current) {
      onOpenMergeBranch(branchName);
      return;
    }
    if (ref.kind === "local" && branchName && !ref.current) {
      await onSwitchBranch(branchName);
      return;
    }
    const remoteBranch = ref.remoteBranch;
    if (ref.kind === "remote" && remoteBranch && !ref.label.endsWith("/HEAD")) {
      const existingBranch = snapshot?.branches.some((branch) => branch.name === remoteBranch);
      if (existingBranch) {
        await onSwitchBranch(remoteBranch);
        return;
      }
      await onRun(text.trackRemoteBranch, () =>
        snapshot && !snapshot.clean
          ? Promise.resolve({
              ok: false,
              stdout: "",
              stderr: text.switchBranchBlockedBody(snapshot.branch, remoteBranch, snapshot.files.length),
              command: text.trackRemoteBranch
            })
          : window.gitool.createBranch({ projectId, name: remoteBranch, startPoint: ref.label })
      );
    }
  }

  async function resetToCommit(mode: ResetMode) {
    if (!selectedEntry) {
      return;
    }
    const label = resetModeLabel(text, mode);
    if (mode === "hard" && hardConfirm.trim() !== selectedEntry.shortHash) {
      return;
    }
    if (!confirm(text.resetConfirm(label, selectedEntry.shortHash))) {
      return;
    }
    await onRun(text.resetToCommit, () => window.gitool.resetToCommit({ projectId, hash: selectedEntry.hash, mode }));
    setHardConfirm("");
  }

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
        <CommitGraphMap
          entries={entries}
          snapshot={snapshot}
          selectedHash={selectedEntry?.hash ?? null}
          busy={busy}
          text={text}
          onSelect={chooseEntry}
          onRefAction={runRefAction}
        />
      </div>

      <aside className="graph-inspector">
        <p className="eyebrow">{text.selectedCommit}</p>
        {selectedEntry ? (
          <>
            <div className="selected-commit">
              <code>{selectedEntry.shortHash}</code>
              <strong>{selectedEntry.message}</strong>
              <span>{selectedEntry.hash}</span>
              <InspectorRefModules refs={selectedRefs} text={text} busy={busy} onAction={runRefAction} />
            </div>

            <div className="graph-action-block">
              <h4>{text.newBranchFromCommit}</h4>
              <label>
                {text.newBranchName}
                <input
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder="feature/branch-name"
                />
              </label>
              <button type="button" disabled={busy || !branchName.trim()} onClick={createBranchFromCommit}>
                <GitBranch size={16} />
                {text.createBranchHere}
              </button>
            </div>

            <div className="graph-action-block danger-block">
              <h4>{text.resetActions}</h4>
              <p className="reset-explain">{text.resetExplain}</p>
              <button type="button" disabled={busy} onClick={() => resetToCommit("soft")}>
                <RotateCcw size={16} />
                <span><strong>{text.resetSoft}</strong><small>{text.resetSoftHelp}</small></span>
              </button>
              <button type="button" disabled={busy} onClick={() => resetToCommit("mixed")}>
                <RotateCcw size={16} />
                <span><strong>{text.resetMixed}</strong><small>{text.resetMixedHelp}</small></span>
              </button>
              <label>
                {text.resetHardType}
                <input
                  value={hardConfirm}
                  onChange={(event) => setHardConfirm(event.target.value)}
                  placeholder={text.resetHardPlaceholder(selectedEntry.shortHash)}
                />
              </label>
              <button
                type="button"
                className="hard-reset-button"
                disabled={busy || hardConfirm.trim() !== selectedEntry.shortHash}
                onClick={() => resetToCommit("hard")}
              >
                <RotateCcw size={16} />
                <span><strong>{text.resetHard}</strong><small>{text.resetHardHelp}</small></span>
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{text.noCommitSelected}</p>
        )}
      </aside>
    </section>
  );
}

function CommitGraphMap({
  entries,
  snapshot,
  selectedHash,
  busy,
  text,
  onSelect,
  onRefAction
}: {
  entries: GitGraphEntry[];
  snapshot: GitSnapshot | null;
  selectedHash: string | null;
  busy: boolean;
  text: ReturnType<typeof uiText>;
  onSelect: (entry: GitGraphEntry) => void;
  onRefAction: (ref: GraphRef, action?: GraphRefAction) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layout = useMemo(() => layoutCommitGraph(entries), [entries]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const width = layout.width;
    const height = layout.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";

    context.strokeStyle = "#dfd8ca";
    context.lineWidth = 1;
    layout.nodes.forEach((node) => {
      context.globalAlpha = 0.38;
      context.beginPath();
      context.moveTo(node.x + 18, 18);
      context.lineTo(node.x + 18, height - 22);
      context.stroke();
    });

    layout.edges.forEach((edge) => {
      drawCommitEdge(context, edge, selectedHash);
    });
  }, [layout, selectedHash]);

  if (!entries.length) {
    return <div className="git-graph-empty">{text.gitTreeEmpty}</div>;
  }

  return (
    <div className="commit-map-scroll">
      <div className="commit-map-stage" style={{ width: layout.width, height: layout.height }}>
        <canvas ref={canvasRef} className="commit-map-canvas" aria-hidden="true" />
        {layout.nodes.map((node) => {
          const active = selectedHash === node.entry.hash;
          const refs = graphRefs(node.entry, snapshot);
          return (
            <div
              key={node.entry.hash}
              className={`commit-node-card ${node.entry.isHead ? "head" : ""} ${active ? "selected" : ""}`}
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(node.entry)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.entry);
                }
              }}
            >
              <span className="commit-node-dot" style={{ background: laneColor(node.lane) }} />
              <code>{node.entry.shortHash}</code>
              <strong>{node.entry.message}</strong>
              <CompactNodeRefs refs={refs} text={text} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactNodeRefs({ refs, text }: { refs: GraphRef[]; text: ReturnType<typeof uiText> }) {
  const currentRef = refs.find((ref) => ref.kind === "local" && ref.current);
  const hiddenCount = refs.length - (currentRef ? 1 : 0);
  if (!currentRef && hiddenCount <= 0) {
    return null;
  }
  return (
    <div className="graph-badges node-badges compact-node-refs">
      {currentRef && (
        <span className="graph-ref local active" title={currentRef.label}>
          {text.currentBranchDisplay(currentRef.label)}
        </span>
      )}
      {hiddenCount > 0 && <span className="graph-ref overflow-ref">{text.hiddenRefCount(hiddenCount)}</span>}
    </div>
  );
}

function InspectorRefModules({
  refs,
  text,
  busy,
  onAction
}: {
  refs: GraphRef[];
  text: ReturnType<typeof uiText>;
  busy: boolean;
  onAction: (ref: GraphRef, action?: GraphRefAction) => Promise<void>;
}) {
  const currentRefs = refs.filter((ref) => ref.kind === "local" && ref.current);
  const headRefs = refs.filter((ref) => ref.kind === "head");
  const otherRefs = refs.filter((ref) => !(ref.kind === "local" && ref.current) && ref.kind !== "head");

  return (
    <div className="inspector-ref-modules">
      <div className="ref-module current-module">
        <div className="ref-module-heading">
          <span>{text.currentBranchModule}</span>
          <small>{text.branchKindCurrent}</small>
        </div>
        <div className="graph-badges inspector-badges separated">
          {currentRefs.map((ref) => (
            <GraphRefBadge key={`${ref.kind}:${ref.label}`} refInfo={ref} text={text} busy={busy} onAction={onAction} variant="detail" />
          ))}
          {headRefs.map((ref) => (
            <span key={`${ref.kind}:${ref.label}`} className="graph-ref head active" title={text.gitTreeHead}>
              {text.headPointer}
            </span>
          ))}
        </div>
      </div>

      <div className="ref-module other-module">
        <div className="ref-module-heading">
          <span>{text.otherRefsModule}</span>
          <small>{text.branchKindOther} / {text.branchKindRemote}</small>
        </div>
        {otherRefs.length ? (
          <div className="graph-badges inspector-badges separated">
            {otherRefs.map((ref) => (
              <GraphRefBadge key={`${ref.kind}:${ref.label}`} refInfo={ref} text={text} busy={busy} onAction={onAction} variant="detail" />
            ))}
          </div>
        ) : (
          <p className="muted">{text.noOtherRefs}</p>
        )}
      </div>
    </div>
  );
}

function GraphRefBadge({
  refInfo,
  text,
  busy,
  onAction,
  variant = "compact"
}: {
  refInfo: GraphRef;
  text: ReturnType<typeof uiText>;
  busy: boolean;
  onAction: (ref: GraphRef, action?: GraphRefAction) => Promise<void>;
  variant?: "compact" | "detail";
}) {
  const actionable = (refInfo.kind === "local" && !refInfo.current) || (refInfo.kind === "remote" && !refInfo.label.endsWith("/HEAD"));
  const displayLabel = graphRefDisplayLabel(refInfo, text);
  const title =
    refInfo.kind === "local"
      ? refInfo.current ? text.currentBranch : text.switchToBranch(refInfo.label)
      : refInfo.kind === "remote"
        ? text.trackRemoteBranchLabel(refInfo.label)
        : refInfo.kind === "tag"
          ? text.refTag
          : text.gitTreeHead;

  if (!actionable) {
    return (
      <span className={`graph-ref ${refInfo.kind} ${refInfo.current || refInfo.tracking ? "active" : ""}`} title={title}>
        {displayLabel}
      </span>
    );
  }

  if (refInfo.kind === "local" && !refInfo.current) {
    return (
      <div className={`graph-ref-group ${variant}`}>
        <span className="graph-ref local" title={refInfo.label}>
          {displayLabel}
        </span>
        <button
          type="button"
          className="graph-ref graph-ref-action switch-action"
          title={text.switchToBranch(refInfo.label)}
          aria-label={text.switchToBranch(refInfo.label)}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            void onAction(refInfo);
          }}
        >
          <ChevronRight size={12} />
          {text.switch}
        </button>
        {variant === "detail" && (
          <button
            type="button"
            className="graph-ref merge-action"
            title={text.mergeBranchLabel(refInfo.label)}
            aria-label={text.mergeBranchLabel(refInfo.label)}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void onAction(refInfo, "merge");
            }}
          >
            <Split size={12} />
            {text.mergeShort}
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`graph-ref ${refInfo.kind} ${refInfo.current || refInfo.tracking ? "active" : ""}`}
      title={title}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        void onAction(refInfo);
      }}
    >
      {displayLabel}
    </button>
  );
}

function graphRefDisplayLabel(refInfo: GraphRef, text: ReturnType<typeof uiText>): string {
  if (refInfo.kind === "head") {
    return "HEAD";
  }
  if (refInfo.kind === "local") {
    return refInfo.current ? text.currentBranchDisplay(refInfo.label) : text.localBranchDisplay(refInfo.label);
  }
  if (refInfo.kind === "remote") {
    return text.remoteBranchDisplay(refInfo.label);
  }
  if (refInfo.kind === "tag") {
    return text.tagDisplay(refInfo.label);
  }
  return refInfo.label;
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
  githubStatus,
  operation,
  busy,
  text,
  onFetch,
  onPull,
  onPush,
  onOpenToken
}: {
  snapshot: GitSnapshot | null;
  githubStatus: GithubLoginStatus | null;
  operation: OperationState;
  busy: boolean;
  text: ReturnType<typeof uiText>;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onOpenToken: () => void;
}) {
  const summary = syncSummary(snapshot, text);
  const signedIn = githubStatus?.state === "signed-in";

  return (
    <section className="sync-workspace">
      <div className={`sync-hero ${summary.tone}`}>
        <div>
          <p className="eyebrow">{text.syncConsole}</p>
          <h3>{summary.title}</h3>
          <p>{summary.body}</p>
        </div>
        <div className="sync-hero-actions">
          <span>{text.syncCloudCheck}</span>
          <button disabled={busy} onClick={onFetch}>
            <RefreshCw size={16} />
            {text.checkNow}
          </button>
        </div>
      </div>

      {!signedIn && (
        <div className="sync-login-strip">
          <Github size={18} />
          <div>
            <strong>{text.githubRequiredTitle}</strong>
            <span>{text.githubRequiredBody}</span>
          </div>
          <button onClick={onOpenToken}>
            <KeyRound size={16} />
            {text.manageGithubLogin}
          </button>
        </div>
      )}

      <div className="sync-dashboard-grid">
        <div className="sync-flow-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{text.syncDailyFlow}</p>
              <h3>{text.syncDailyFlowHint}</h3>
            </div>
            <Upload size={18} />
          </div>

          <SyncStep
            index="1"
            icon={<Download size={18} />}
            actionIcon={<Download size={18} />}
            title={text.syncFetchTitle}
            body={text.syncFetchBody}
            actionLabel={text.fetch}
            busy={busy}
            onAction={onFetch}
          />
          <SyncStep
            index="2"
            icon={<Download size={18} />}
            actionIcon={<Download size={18} />}
            title={text.syncPullTitle}
            body={text.syncPullBody}
            actionLabel={text.pull}
            busy={busy}
            onAction={onPull}
          />
          <SyncStep
            index="3"
            icon={<Upload size={18} />}
            actionIcon={<Upload size={18} />}
            title={text.syncPushTitle}
            body={text.syncPushBody}
            actionLabel={text.push}
            busy={busy}
            primary
            onAction={onPush}
          />
        </div>

        <aside className="sync-side-stack">
          <div className="sync-card sync-state-card">
            <div className="sync-card-heading">
              <GitBranch size={20} />
              <div>
                <p className="eyebrow">{text.repositoryState}</p>
                <h3>{snapshot ? snapshot.branch : text.notSet}</h3>
              </div>
            </div>
            <div className="sync-stats">
              <SummaryItem label={text.upstream} value={snapshot?.upstream ?? text.notSet} />
              <SummaryItem label={text.remoteSync} value={snapshot ? text.syncLabel(snapshot.remoteSync) : text.notSet} tone={snapshot?.remoteSync === "synced" ? "good" : "warn"} />
              <SummaryItem label={text.ahead} value={String(snapshot?.ahead ?? 0)} />
              <SummaryItem label={text.behind} value={String(snapshot?.behind ?? 0)} />
              <SummaryItem label={text.changedFiles} value={snapshot?.clean ? text.clean : text.changes(snapshot?.files.length ?? 0)} tone={snapshot?.clean ? "good" : "warn"} />
              <SummaryItem label={text.githubAccount} value={githubStatusText(text, githubStatus)} tone={signedIn ? "good" : "warn"} />
            </div>
          </div>

          <SyncRiskPanel snapshot={snapshot} text={text} />
          <CommandOutput operation={operation} text={text} />
        </aside>
      </div>
    </section>
  );
}

function SyncStep({
  index,
  icon,
  actionIcon,
  title,
  body,
  actionLabel,
  busy,
  primary,
  onAction
}: {
  index: string;
  icon: ReactNode;
  actionIcon: ReactNode;
  title: string;
  body: string;
  actionLabel: string;
  busy: boolean;
  primary?: boolean;
  onAction: () => void;
}) {
  return (
    <div className="sync-step">
      <div className="sync-step-index">{index}</div>
      <div className="sync-step-icon">{icon}</div>
      <div className="sync-step-copy">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      <button className={`sync-step-button ${primary ? "commit-button" : ""}`} disabled={busy} onClick={onAction}>
        {actionIcon}
        {actionLabel}
      </button>
    </div>
  );
}

function SyncRiskPanel({ snapshot, text }: { snapshot: GitSnapshot | null; text: ReturnType<typeof uiText> }) {
  const risks = syncRiskItems(snapshot, text);
  return (
    <div className="sync-card sync-risk-card">
      <div className="sync-card-heading">
        <Split size={20} />
        <div>
          <p className="eyebrow">{text.syncRiskTitle}</p>
          <h3>{risks[0]?.title ?? text.syncRiskClearTitle}</h3>
        </div>
      </div>
      <div className="sync-risk-list">
        {risks.map((risk) => (
          <div className={`sync-risk-item ${risk.tone}`} key={`${risk.title}:${risk.body}`}>
            <strong>{risk.title}</strong>
            <span>{risk.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionPanel({
  panel,
  snapshot,
  settings,
  operation,
  projectId,
  mergeSourceHint,
  onClose,
  onRun,
  onSwitchBranch,
  onSettings,
  githubStatus,
  onGithubStatusChange,
  text,
  onPanelChange
}: {
  panel: Exclude<Panel, null>;
  snapshot: GitSnapshot | null;
  settings: AppSettings | null;
  operation: OperationState;
  projectId: string;
  mergeSourceHint: string;
  onClose: () => void;
  onRun: (title: string, action: () => Promise<GitCommandResult>, refresh?: boolean) => Promise<void>;
  onSwitchBranch: (branchName: string) => Promise<void>;
  onSettings: (settings: AppSettings) => void;
  githubStatus: GithubLoginStatus | null;
  onGithubStatusChange: (status: GithubLoginStatus) => void;
  text: ReturnType<typeof uiText>;
  onPanelChange: (panel: Panel) => void;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState(snapshot?.upstream?.replace(/^origin\//, "") || "main");
  const [mergeSource, setMergeSource] = useState(mergeSourceHint);
  const [head, setHead] = useState(snapshot?.branch ?? "");
  const [body, setBody] = useState("");
  const [pullMode, setPullMode] = useState<PullMode>(settings?.pullMode ?? "ff-only");
  const [commitTemplate, setCommitTemplate] = useState(settings?.commitTemplate ?? "");
  const [language, setLanguage] = useState<LanguagePreference>(settings?.language ?? "system");
  const [clientId, setClientId] = useState(settings?.githubOAuthClientId ?? "");
  const [tokenLoginBusy, setTokenLoginBusy] = useState(false);
  const [tokenMessage, setTokenMessage] = useState("");
  const [showPanelOutput, setShowPanelOutput] = useState(false);
  const mergeableBranches = useMemo(() => snapshot?.branches.filter((branch) => !branch.current) ?? [], [snapshot?.branches]);
  const currentLocalBranch = useMemo(() => snapshot?.branches.find((branch) => branch.current) ?? null, [snapshot?.branches]);
  const currentBranch = snapshot?.branch ?? text.currentBranch;

  useEffect(() => {
    setShowPanelOutput(false);
  }, [panel]);

  useEffect(() => {
    if (panel !== "merge") {
      return;
    }
    setMergeSource((current) => {
      if (mergeSourceHint && mergeableBranches.some((branch) => branch.name === mergeSourceHint)) {
        return mergeSourceHint;
      }
      if (current && mergeableBranches.some((branch) => branch.name === current)) {
        return current;
      }
      return mergeableBranches[0]?.name ?? "";
    });
  }, [mergeSourceHint, mergeableBranches, panel]);

  const titleMap: Record<Exclude<Panel, null>, string> = {
    branch: text.branch,
    merge: text.mergeBranch,
    stash: text.stash,
    tag: text.tag,
    rebase: text.rebase,
    pr: text.pr,
    token: text.tokenTitle,
    settings: text.settings,
    history: text.history,
    more: text.moreActions
  };

  const actionCards: Array<{ panel: Exclude<Panel, null>; icon: ReactNode; title: string; description: string; tone?: "danger" }> = [
    { panel: "branch", icon: <GitBranch size={18} />, title: text.branch, description: text.branchHelp },
    { panel: "merge", icon: <Split size={18} />, title: text.mergeBranch, description: text.mergeHelp },
    { panel: "stash", icon: <Archive size={18} />, title: text.stash, description: text.stashHelp },
    { panel: "tag", icon: <Tags size={18} />, title: text.tag, description: text.tagHelp },
    { panel: "rebase", icon: <Split size={18} />, title: text.rebase, description: text.rebaseHelp, tone: "danger" },
    { panel: "pr", icon: <GitPullRequest size={18} />, title: text.pr, description: text.prHelp },
    { panel: "history", icon: <History size={18} />, title: text.history, description: text.historyHelp },
    { panel: "token", icon: <KeyRound size={18} />, title: text.token, description: text.tokenHelp },
    { panel: "settings", icon: <Settings size={18} />, title: text.settings, description: text.settingsHelp }
  ];

  async function runPanelAction(title: string, action: () => Promise<GitCommandResult>, refresh?: boolean) {
    setShowPanelOutput(true);
    await onRun(title, action, refresh);
  }

  async function startTokenWebLogin() {
    setTokenLoginBusy(true);
    setTokenMessage(text.waitingForGithub);
    try {
      const result = await window.gitool.loginWithGithubBrowser();
      onGithubStatusChange(result.status);
      setTokenMessage(result.ok ? text.githubLoginComplete : result.message ?? text.githubInvalid);
    } catch (error) {
      setTokenMessage(formatError(error));
    } finally {
      setTokenLoginBusy(false);
    }
  }

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
            <p className="panel-help">{text.advancedActionsHelp}</p>
            <div className="more-grid">
              {actionCards.map((item) => (
                <button key={item.panel} className={item.tone === "danger" ? "caution" : ""} onClick={() => onPanelChange(item.panel)}>
                  {item.icon}
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {panel === "branch" && (
          <div className="modal-content">
            <p className="panel-help">{text.branchIntro}</p>
            <p className="panel-help">{text.branchLocationHint}</p>
            <p className="panel-help">{text.branchMergeHelp(currentBranch)}</p>
            <label>{text.branchName}<input value={name} onChange={(event) => setName(event.target.value)} placeholder="feature/workflow" /></label>
            <label>{text.startPoint}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={text.startPointPlaceholder} /></label>
            <button disabled={!name.trim()} onClick={() => runPanelAction(text.createAndSwitch, () => window.gitool.createBranch({ projectId, name, startPoint: target }))}>{text.createAndSwitch}</button>
            <div className="branch-current-card">
              <span>{text.branchKindCurrent}</span>
              <strong>{currentLocalBranch?.name ?? currentBranch}</strong>
              <small>{text.branchCurrentExplanation}</small>
            </div>
            <div className="list-heading">{text.otherLocalBranches}</div>
            <div className="list-block">
              {mergeableBranches.map((branch) => (
                <div key={branch.name} className="mini-row">
                  <span className="branch-row-name">
                    <strong>{branch.name}</strong>
                    <small>{text.branchKindOther}</small>
                  </span>
                  <div>
                    <button onClick={() => onSwitchBranch(branch.name)}>{text.switch}</button>
                    <button
                      onClick={() => {
                        setMergeSource(branch.name);
                        onPanelChange("merge");
                      }}
                    >
                      {text.mergeIntoCurrent}
                    </button>
                    <button disabled={branch.current} onClick={() => confirm(text.deleteBranchConfirm) && runPanelAction(text.deleteBranch, () => window.gitool.deleteBranch(projectId, branch.name))}>{text.delete}</button>
                  </div>
                </div>
              ))}
              {!mergeableBranches.length && <p className="muted">{text.noOtherLocalBranches}</p>}
            </div>
          </div>
        )}

        {panel === "merge" && (
          <div className="modal-content merge-panel">
            <p className="panel-help">{text.mergeWizardIntro}</p>
            <div className="merge-flow" aria-label={text.mergeBranch}>
              <div className="merge-node source">
                <span>{text.mergeSourceBranch}</span>
                <strong>{mergeSource || text.noMergeSource}</strong>
              </div>
              <ChevronRight className="merge-arrow" size={22} />
              <div className="merge-node target">
                <span>{text.mergeTargetBranch}</span>
                <strong>{currentBranch}</strong>
              </div>
            </div>
            <label>
              {text.mergeSourceBranch}
              <select value={mergeSource} onChange={(event) => setMergeSource(event.target.value)} disabled={!mergeableBranches.length}>
                {mergeableBranches.map((branch) => (
                  <option key={branch.name} value={branch.name}>{branch.name}</option>
                ))}
              </select>
            </label>
            <div className="merge-risk-list">
              {mergeSource ? <div>{text.mergeWillMerge(mergeSource, currentBranch)}</div> : <div>{text.noMergeSource}</div>}
              {!snapshot?.clean && <div className="warning">{text.mergeLocalChangesWarning}</div>}
              <div>{text.mergeConflictWarning}</div>
              <div>{text.mergeNoDeleteSource}</div>
            </div>
            <button
              className="commit-button"
              disabled={!mergeSource}
              onClick={() => confirm(text.mergeBranchConfirm(mergeSource, currentBranch)) && runPanelAction(text.mergeBranch, () => window.gitool.mergeBranch(projectId, mergeSource))}
            >
              <Split size={16} />
              {text.mergeSelectedBranch}
            </button>
          </div>
        )}

        {panel === "stash" && (
          <div className="modal-content">
            <p className="panel-help">{text.stashIntro}</p>
            <label>{text.stashMessage}<input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={text.stashPlaceholder} /></label>
            <button onClick={() => runPanelAction(text.createStash, () => window.gitool.createStash(projectId, message))}>{text.createStash}</button>
            <div className="list-block">
              {snapshot?.stashes.map((stash) => {
                const ref = stash.split(":")[0];
                return (
                  <div key={stash} className="mini-row">
                    <span>{stash}</span>
                    <div>
                      <button onClick={() => runPanelAction(text.applyStash, () => window.gitool.applyStash(projectId, ref))}>{text.apply}</button>
                      <button onClick={() => confirm(text.deleteStashConfirm) && runPanelAction(text.dropStash, () => window.gitool.dropStash(projectId, ref))}>{text.delete}</button>
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
            <p className="panel-help">{text.tagIntro}</p>
            <label>{text.tagName}<input value={name} onChange={(event) => setName(event.target.value)} placeholder="v1.0.0" /></label>
            <label>{text.tagMessage}<input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={text.optional} /></label>
            <button disabled={!name.trim()} onClick={() => runPanelAction(text.createTag, () => window.gitool.createTag({ projectId, name, message }))}>{text.createTag}</button>
            <div className="list-block">
              {snapshot?.tags.map((tag) => (
                <div key={tag} className="mini-row">
                  <span>{tag}</span>
                  <button onClick={() => confirm(text.deleteTagConfirm) && runPanelAction(text.deleteTag, () => window.gitool.deleteTag(projectId, tag))}>{text.delete}</button>
                </div>
              ))}
              {!snapshot?.tags.length && <p className="muted">{text.noTags}</p>}
            </div>
          </div>
        )}

        {panel === "rebase" && (
          <div className="modal-content">
            <p className="panel-help caution">{text.rebaseIntro}</p>
            <label>{text.rebaseTarget}<input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={text.rebaseTargetPlaceholder} /></label>
            <button disabled={!target.trim()} onClick={() => confirm(text.rebaseConfirm) && runPanelAction(text.rebase, () => window.gitool.rebaseOnto({ projectId, target }))}>{text.startRebase}</button>
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
                runPanelAction(
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

        {showPanelOutput && (
          <div className="modal-content panel-command-output">
            <CommandOutput operation={operation} text={text} />
          </div>
        )}

        {panel === "token" && (
          <div className="modal-content">
            <label>{text.oauthClientId}<input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={text.oauthClientIdPlaceholder} /></label>
            <div className="button-row">
              <button
                onClick={async () => {
                  const next = await window.gitool.saveSettings({ githubOAuthClientId: clientId.trim() });
                  onSettings(next);
                  setTokenMessage(text.oauthClientSaved);
                }}
              >
                {text.saveClientId}
              </button>
              <button className="primary-inline" onClick={startTokenWebLogin} disabled={tokenLoginBusy}>
                <ExternalLink size={16} />
                {text.loginWithBrowser}
              </button>
            </div>
            <div className="token-status">
              <span>{text.tokenStatus}</span>
              <strong>{githubStatusText(text, githubStatus)}</strong>
            </div>
            <p className="muted">{tokenMessage || text.webLoginHelp}</p>
            <button
              onClick={async () => {
                const next = await window.gitool.clearGithubToken();
                onSettings(next);
                onGithubStatusChange(await window.gitool.getGithubStatus());
                setTokenMessage(text.tokenNotConfigured);
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

function layoutCommitGraph(entries: GitGraphEntry[]): CommitGraphLayout {
  const nodeWidth = 360;
  const nodeHeight = 86;
  const rowHeight = 112;
  const laneSpacing = 108;
  const paddingX = 28;
  const paddingY = 28;
  const nodes = entries.map((entry, index) => {
    const lane = graphLane(entry);
    return {
      entry,
      lane,
      x: paddingX + lane * laneSpacing,
      y: paddingY + index * rowHeight,
      width: nodeWidth,
      height: nodeHeight
    };
  });
  const nodeByHash = new Map(nodes.map((node) => [node.entry.hash, node]));
  const edges = nodes.flatMap((node) =>
    node.entry.parents
      .map((parentHash) => nodeByHash.get(parentHash))
      .filter((parent): parent is CommitGraphNode => Boolean(parent))
      .map((parent) => ({ from: node, to: parent }))
  );
  const maxLane = nodes.reduce((value, node) => Math.max(value, node.lane), 0);
  return {
    nodes,
    edges,
    width: paddingX * 2 + maxLane * laneSpacing + nodeWidth,
    height: Math.max(260, paddingY * 2 + Math.max(0, entries.length - 1) * rowHeight + nodeHeight)
  };
}

function drawCommitEdge(context: CanvasRenderingContext2D, edge: CommitGraphEdge, selectedHash: string | null): void {
  const fromX = edge.to.x + 20;
  const fromY = edge.to.y;
  const toX = edge.from.x + 20;
  const toY = edge.from.y + edge.from.height;
  const highlight = selectedHash === edge.from.entry.hash || selectedHash === edge.to.entry.hash;
  const color = highlight ? "#8a3a22" : laneColor(edge.from.lane);
  const midY = (fromY + toY) / 2;

  context.globalAlpha = highlight ? 0.95 : 0.58;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = highlight ? 2.8 : 2.2;
  context.beginPath();
  context.moveTo(fromX, fromY);
  if (Math.abs(fromX - toX) < 3) {
    context.lineTo(toX, toY);
  } else {
    context.bezierCurveTo(fromX, midY, toX, midY, toX, toY);
  }
  context.stroke();

  context.beginPath();
  context.moveTo(toX, toY);
  context.lineTo(toX - 5, toY + 9);
  context.lineTo(toX + 5, toY + 9);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;
}

function graphRefs(entry: GitGraphEntry, snapshot: GitSnapshot | null): GraphRef[] {
  const refs = new Map<string, GraphRef>();
  if (entry.isHead) {
    refs.set("HEAD", { label: "HEAD", kind: "head", current: true });
  }

  for (const rawRef of entry.refs?.split(", ") ?? []) {
    const raw = rawRef.trim();
    if (!raw || raw === "HEAD") {
      continue;
    }
    if (raw.startsWith("HEAD -> ")) {
      const branchName = raw.replace("HEAD -> ", "");
      refs.set(branchName, {
        label: branchName,
        kind: "local",
        branchName,
        current: snapshot?.branch === branchName
      });
      continue;
    }
    if (raw.startsWith("tag: ")) {
      const label = raw.replace("tag: ", "");
      refs.set(`tag:${label}`, { label, kind: "tag" });
      continue;
    }

    const remote = remoteRef(raw, snapshot);
    if (remote) {
      refs.set(raw, {
        label: raw,
        kind: "remote",
        remoteBranch: remote.branch,
        tracking: snapshot?.upstream === raw
      });
      continue;
    }

    refs.set(raw, {
      label: raw,
      kind: "local",
      branchName: raw,
      current: snapshot?.branch === raw
    });
  }

  if (entry.isUpstream && snapshot?.upstream && !refs.has(snapshot.upstream)) {
    refs.set(snapshot.upstream, {
      label: snapshot.upstream,
      kind: "remote",
      remoteBranch: remoteRef(snapshot.upstream, snapshot)?.branch,
      tracking: true
    });
  }

  return [...refs.values()];
}

function remoteRef(ref: string, snapshot: GitSnapshot | null): { remote: string; branch: string } | null {
  const configuredRemotes = snapshot?.remotes.map((remote) => remote.name) ?? [];
  const remoteNames = (configuredRemotes.length ? configuredRemotes : ["origin", "upstream"]).sort((a, b) => b.length - a.length);
  const remote = remoteNames.find((name) => ref.startsWith(`${name}/`));
  if (!remote) {
    return null;
  }
  return { remote, branch: ref.slice(remote.length + 1) };
}

function normalizeGraph(graph: string): string {
  const trimmed = graph.replace(/\s+$/g, "");
  return trimmed.includes("*") ? trimmed : "*";
}

function graphLane(entry: GitGraphEntry): number {
  return Math.max(0, normalizeGraph(entry.graph).indexOf("*"));
}

function laneColor(index: number): string {
  const colors = ["#8a6a17", "#245a43", "#2f5f9a", "#8a3a22", "#6b4f95", "#6c6f2e", "#9a5d35", "#4d6c78"];
  return colors[index % colors.length];
}

function resetModeLabel(text: ReturnType<typeof uiText>, mode: ResetMode): string {
  if (mode === "soft") {
    return text.resetSoft;
  }
  if (mode === "mixed") {
    return text.resetMixed;
  }
  return text.resetHard;
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

function syncSummary(snapshot: GitSnapshot | null, text: ReturnType<typeof uiText>) {
  if (!snapshot) {
    return { title: text.notSet, body: text.projectStatusHint, tone: "neutral" };
  }
  if (!snapshot.upstream) {
    return { title: text.syncNoUpstreamTitle, body: text.syncNoUpstreamSummary, tone: "warn" };
  }
  if (snapshot.remoteSync === "diverged") {
    return { title: text.remoteDivergedTitle, body: text.remoteDivergedBody(snapshot.ahead, snapshot.behind), tone: "danger" };
  }
  if (snapshot.remoteSync === "behind") {
    return { title: text.remoteBehindTitle, body: text.remoteBehindBody(snapshot.behind), tone: "warn" };
  }
  if (snapshot.remoteSync === "ahead") {
    return { title: text.syncAheadTitle, body: text.syncAheadBody(snapshot.ahead), tone: "good" };
  }
  if (!snapshot.clean) {
    return { title: text.syncLabel(snapshot.remoteSync), body: text.syncLocalOnlyBody, tone: "warn" };
  }
  return { title: text.syncLabel(snapshot.remoteSync), body: text.syncReadyBody, tone: "good" };
}

function syncRiskItems(snapshot: GitSnapshot | null, text: ReturnType<typeof uiText>) {
  if (!snapshot) {
    return [{ tone: "neutral", title: text.syncRiskWaitingTitle, body: text.projectStatusHint }];
  }

  const items: Array<{ tone: "good" | "warn" | "danger" | "neutral"; title: string; body: string }> = [];
  if (!snapshot.upstream) {
    items.push({ tone: "warn", title: text.syncNoUpstreamTitle, body: text.syncNoUpstreamBody });
  }
  if (snapshot.remoteSync === "diverged") {
    items.push({ tone: "danger", title: text.remoteDivergedTitle, body: text.remoteDivergedBody(snapshot.ahead, snapshot.behind) });
  } else if (snapshot.remoteSync === "behind") {
    items.push({ tone: "warn", title: text.remoteBehindTitle, body: text.remoteBehindBody(snapshot.behind) });
  }
  if (snapshot.remoteSync === "ahead") {
    items.push({ tone: "good", title: text.syncAheadTitle, body: text.syncAheadBody(snapshot.ahead) });
  }
  if (!snapshot.clean) {
    items.push({ tone: "warn", title: text.syncLocalChangesTitle, body: text.pullRiskLocalChanges });
  }
  if (!items.length) {
    items.push({ tone: "good", title: text.syncRiskClearTitle, body: text.syncRiskClearBody });
  }
  return items;
}

function pullRiskMessage(snapshot: GitSnapshot, mode: PullMode, text: ReturnType<typeof uiText>) {
  const risks: string[] = [];
  if (!snapshot.upstream) {
    risks.push(text.pullRiskNoUpstream);
  }
  if (!snapshot.clean) {
    risks.push(text.pullRiskLocalChanges);
  }
  if (snapshot.remoteSync === "diverged") {
    risks.push(mode === "ff-only" ? text.pullRiskDivergedFastForward : text.pullRiskDiverged);
  } else if (!snapshot.clean && snapshot.behind > 0) {
    risks.push(text.pullRiskRemoteChanges(snapshot.behind));
  }
  return risks.join("\n");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
