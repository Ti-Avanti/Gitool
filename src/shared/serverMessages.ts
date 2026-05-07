import type { EffectiveLanguage } from "./types";

type ServerMessageKey =
  | "projectMissing"
  | "secureStorageUnavailable"
  | "tokenRequired"
  | "githubRemoteMissing"
  | "githubPrFailed"
  | "githubStatusFailed"
  | "githubOAuthClientIdRequired"
  | "githubOAuthStartFailed"
  | "githubOAuthTokenFailed"
  | "directoryMissing"
  | "untrackedDiffUnavailable"
  | "noDiff"
  | "commitMessageRequired"
  | "gitCommandFailed"
  | "selectFilesRequired"
  | "selectProjectDirectory"
  | "pushNoBranch"
  | "pushNoRemote"
  | "pushVerified"
  | "pushVerificationFailed";

const messages: Record<EffectiveLanguage, Record<ServerMessageKey, string>> = {
  "zh-CN": {
    projectMissing: "项目不存在或已被移除。",
    secureStorageUnavailable: "当前系统安全存储不可用，请使用本机 Git 凭据或 SSH 推送。",
    tokenRequired: "请先配置 GitHub Token。",
    githubRemoteMissing: "当前项目没有可识别的 GitHub 远程地址。",
    githubPrFailed: "GitHub PR 创建失败",
    githubStatusFailed: "无法读取 GitHub 登录状态",
    githubOAuthClientIdRequired: "请先配置 GitHub OAuth App 的 Client ID。",
    githubOAuthStartFailed: "GitHub 网页登录启动失败",
    githubOAuthTokenFailed: "GitHub 网页登录授权失败",
    directoryMissing: "目录不存在。",
    untrackedDiffUnavailable: "未跟踪文件暂时没有可显示的 Git diff。提交前会通过 git add 纳入版本控制。",
    noDiff: "当前文件没有可显示的差异。",
    commitMessageRequired: "提交信息不能为空。",
    gitCommandFailed: "Git 命令执行失败。",
    selectFilesRequired: "请先选择文件。",
    selectProjectDirectory: "选择 Git 项目目录",
    pushNoBranch: "当前处于分离 HEAD 状态，无法判断要推送的分支。",
    pushNoRemote: "当前分支没有上游远端，也没有 origin 远端可自动设置。",
    pushVerified: "已确认远端分支与本地提交一致。",
    pushVerificationFailed: "推送命令结束后，远端分支仍未更新到本地提交。请检查远端、权限或分支保护规则。"
  },
  "en-US": {
    projectMissing: "The project does not exist or has been removed.",
    secureStorageUnavailable: "System secure storage is unavailable. Use local Git credentials or SSH to push.",
    tokenRequired: "Configure a GitHub token first.",
    githubRemoteMissing: "This project does not have a recognizable GitHub remote URL.",
    githubPrFailed: "Failed to create GitHub pull request",
    githubStatusFailed: "Unable to read GitHub login status",
    githubOAuthClientIdRequired: "Configure the GitHub OAuth App Client ID first.",
    githubOAuthStartFailed: "Failed to start GitHub web login",
    githubOAuthTokenFailed: "GitHub web login authorization failed",
    directoryMissing: "Directory does not exist.",
    untrackedDiffUnavailable: "Git diff is not available for untracked files yet. The file will be added with git add before commit.",
    noDiff: "There is no diff to display for this file.",
    commitMessageRequired: "Commit message cannot be empty.",
    gitCommandFailed: "Git command failed.",
    selectFilesRequired: "Select files first.",
    selectProjectDirectory: "Select Git project directory",
    pushNoBranch: "The repository is in detached HEAD state, so Gitool cannot determine which branch to push.",
    pushNoRemote: "The current branch has no upstream remote and no origin remote was found.",
    pushVerified: "Verified that the remote branch matches the local commit.",
    pushVerificationFailed: "The push command finished, but the remote branch still does not match the local commit. Check the remote, permissions, or branch protection rules."
  }
};

export function serverMessage(language: EffectiveLanguage, key: ServerMessageKey): string {
  return messages[language][key];
}
