import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { simpleGit, type SimpleGit } from "simple-git";
import { getGitUrl, stagingDir } from "../config";
import { getUserInfo } from "../api/client";
import { ModaicError } from "../exceptions";

/** Files to (re)write into the repo before committing. */
export interface PushFiles {
  /** Parsed `config.json` content. Omit to leave the existing file untouched. */
  config?: object;
  /** Parsed `program.json` content. Omit to leave the existing file untouched. */
  program?: object;
}

export interface SyncAndPushOptions {
  /** "owner/name". */
  repo: string;
  /** Branch to commit and push to. */
  branch: string;
  /** Resolved access token. */
  token: string;
  /** Files to write. */
  files: PushFiles;
  /** Optional metadata written to README.md YAML frontmatter. */
  metadata?: Record<string, unknown> | null;
  /** Optional local file paths copied to the repo root. */
  extraFiles?: string[] | null;
  /** Commit message. */
  commitMessage: string;
  /** Optional tag to create and push. */
  tag?: string;
}

/** The commit produced by a push. */
export interface Commit {
  repo: string;
  sha: string;
}

function makeGitUrl(repo: string, token: string, login: string): string {
  const gitUrl = getGitUrl();
  const protocol = gitUrl.startsWith("https://") ? "https://" : "http://";
  const host = gitUrl.replace(/^https?:\/\//, "");
  return `${protocol}${login}:${token}@${host}/${repo}.git`;
}

function writeJson(filePath: string, obj: object): void {
  // Match Python's json.dump(..., indent=2): 2-space indent, no trailing newline.
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

/** Create or replace the README's YAML frontmatter, preserving the body. */
function writeReadmeFrontmatter(filePath: string, metadata: Record<string, unknown>): void {
  let body = "";
  if (fs.existsSync(filePath)) {
    body = matter(fs.readFileSync(filePath, "utf-8")).content;
  }
  fs.writeFileSync(filePath, matter.stringify(body, metadata));
}

/** Check out `branch`, tracking origin/branch, falling back to origin/main, then a fresh branch. */
async function checkoutBranch(git: SimpleGit, branch: string): Promise<void> {
  try {
    await git.checkout(["-B", branch, `origin/${branch}`]);
    return;
  } catch {
    /* branch does not exist on origin yet */
  }
  try {
    await git.checkout(["-B", branch, "origin/main"]);
    return;
  } catch {
    /* main does not exist either (brand new repo with no commits) */
  }
  await git.checkout(["-B", branch]);
}

/**
 * Simpler version of the Python SDK's `sync_and_push`: pull the latest commit of
 * the target branch, write the program/config/metadata/extra files, commit, and
 * push using a token-authenticated remote. Assumes the remote repo already exists.
 */
export async function syncAndPush(opts: SyncAndPushOptions): Promise<Commit> {
  const dir = stagingDir(opts.repo);
  fs.mkdirSync(dir, { recursive: true });

  const git = simpleGit(dir);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    await git.init();
  }

  const user = await getUserInfo(opts.token);
  const remoteUrl = makeGitUrl(opts.repo, opts.token, user.login);
  const remotes = await git.getRemotes();
  if (remotes.some((r) => r.name === "origin")) {
    await git.remote(["set-url", "origin", remoteUrl]);
  } else {
    await git.addRemote("origin", remoteUrl);
  }

  try {
    await git.fetch("origin");
  } catch (e) {
    const msg = String(e).toLowerCase();
    if (msg.includes("not found") || msg.includes("repository")) {
      throw new ModaicError(`Repository '${opts.repo}' does not exist`);
    }
    throw new ModaicError(`Git fetch failed: ${e}`);
  }

  await checkoutBranch(git, opts.branch);

  // Write the desired repo contents.
  if (opts.files.config) writeJson(path.join(dir, "config.json"), opts.files.config);
  if (opts.files.program) writeJson(path.join(dir, "program.json"), opts.files.program);
  if (opts.metadata) writeReadmeFrontmatter(path.join(dir, "README.md"), opts.metadata);
  if (opts.extraFiles) {
    for (const file of opts.extraFiles) {
      fs.copyFileSync(file, path.join(dir, path.basename(file)));
    }
  }

  await git.add(["-A"]);
  await git.addConfig("user.email", user.email);
  await git.addConfig("user.name", user.name);

  try {
    await git.commit(opts.commitMessage);
  } catch (e) {
    if (String(e).toLowerCase().includes("nothing to commit")) {
      throw new ModaicError("Nothing to commit");
    }
    throw new ModaicError(`Git commit failed: ${e}`);
  }

  try {
    await git.push("origin", opts.branch);
    if (opts.tag) {
      await git.addTag(opts.tag);
      await git.raw(["push", "origin", opts.tag]);
    }
  } catch (e) {
    throw new ModaicError(`Git push failed: ${e}`);
  }

  const sha = (await git.revparse(["HEAD"])).trim();
  return { repo: opts.repo, sha };
}
