import { app, safeStorage } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AppSettings, Project, ProjectInput } from "../shared/types";
import { serverMessage } from "../shared/serverMessages";
import type { EffectiveLanguage } from "../shared/types";

type StoredConfig = {
  projects: Project[];
  settings: Omit<AppSettings, "githubTokenConfigured" | "effectiveLanguage">;
  githubTokenEncrypted?: string;
};

const defaultSettings: Omit<AppSettings, "githubTokenConfigured" | "effectiveLanguage"> = {
  commitTemplate: "",
  pullMode: "ff-only",
  language: "system",
  githubOAuthClientId: ""
};

export class ConfigStore {
  private readonly configPath: string;
  private config: StoredConfig = {
    projects: [],
    settings: defaultSettings
  };

  constructor() {
    this.configPath = path.join(app.getPath("userData"), "config.json");
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    if (!existsSync(this.configPath)) {
      await this.save();
      return;
    }

    const raw = await readFile(this.configPath, "utf8");
    if (!raw.trim()) {
      await this.save();
      return;
    }

    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    this.config = {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
      githubTokenEncrypted: parsed.githubTokenEncrypted
    };
  }

  listProjects(): Project[] {
    return [...this.config.projects].sort((a, b) => {
      if (a.favorite !== b.favorite) {
        return a.favorite ? -1 : 1;
      }
      return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
    });
  }

  getProject(projectId: string): Project {
    const project = this.config.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(serverMessage(this.getEffectiveLanguage(), "projectMissing"));
    }
    return project;
  }

  async addProject(input: ProjectInput, resolvedPath: string): Promise<Project> {
    const existing = this.config.projects.find((item) => item.path.toLowerCase() === resolvedPath.toLowerCase());
    if (existing) {
      existing.lastOpenedAt = new Date().toISOString();
      await this.save();
      return existing;
    }

    const project: Project = {
      id: crypto.randomUUID(),
      name: input.name?.trim() || path.basename(resolvedPath),
      path: resolvedPath,
      favorite: false,
      lastOpenedAt: new Date().toISOString()
    };

    this.config.projects.push(project);
    await this.save();
    return project;
  }

  async removeProject(projectId: string): Promise<Project[]> {
    this.config.projects = this.config.projects.filter((project) => project.id !== projectId);
    await this.save();
    return this.listProjects();
  }

  getSettings(): AppSettings {
    return {
      ...this.config.settings,
      effectiveLanguage: this.getEffectiveLanguage(),
      githubTokenConfigured: Boolean(this.config.githubTokenEncrypted)
    };
  }

  async saveSettings(settings: Partial<Omit<AppSettings, "githubTokenConfigured" | "effectiveLanguage">>): Promise<AppSettings> {
    this.config.settings = { ...this.config.settings, ...settings };
    await this.save();
    return this.getSettings();
  }

  async setGithubToken(token: string): Promise<AppSettings> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(serverMessage(this.getEffectiveLanguage(), "secureStorageUnavailable"));
    }
    this.config.githubTokenEncrypted = safeStorage.encryptString(token).toString("base64");
    await this.save();
    return this.getSettings();
  }

  async clearGithubToken(): Promise<AppSettings> {
    this.config.githubTokenEncrypted = undefined;
    await this.save();
    return this.getSettings();
  }

  getGithubToken(): string | null {
    if (!this.config.githubTokenEncrypted || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    return safeStorage.decryptString(Buffer.from(this.config.githubTokenEncrypted, "base64"));
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, "utf8");
  }

  getEffectiveLanguage(): EffectiveLanguage {
    if (this.config.settings.language === "zh-CN" || this.config.settings.language === "en-US") {
      return this.config.settings.language;
    }
    const candidates = [app.getLocale(), ...app.getPreferredSystemLanguages()].map((locale) => locale.toLowerCase());
    return candidates.some((locale) => locale.startsWith("zh")) ? "zh-CN" : "en-US";
  }
}
