import os from "node:os";
import path from "node:path";
import { AuthenticationError } from "./exceptions";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Base URL of the Modaic REST API. Mirrors the Python SDK default.
 */
export function getApiUrl(): string {
  return stripTrailingSlash(process.env.MODAIC_API_URL || "https://api.modaic.dev");
}

/**
 * Base URL of the Modaic git host. Mirrors the Python SDK default.
 */
export function getGitUrl(): string {
  return stripTrailingSlash(process.env.MODAIC_GIT_URL || "https://git.modaic.dev");
}

/**
 * Resolve the access token: explicit arg first, then the MODAIC_TOKEN env var.
 * Throws if neither is set.
 */
export function resolveToken(accessToken?: string | null): string {
  const token = accessToken ?? process.env.MODAIC_TOKEN;
  if (!token) {
    throw new AuthenticationError(
      "No access token provided. Pass access_token or set the MODAIC_TOKEN environment variable.",
    );
  }
  return token;
}

/**
 * Root cache directory used for staging git clones. Mirrors the Python SDK (`~/.cache/modaic`).
 */
export function getCacheDir(): string {
  return process.env.MODAIC_CACHE || path.join(os.homedir(), ".cache", "modaic");
}

/**
 * Local staging directory for a repo's git working tree, keyed by "owner/name".
 */
export function stagingDir(repo: string): string {
  return path.join(getCacheDir(), "staging", ...repo.split("/"));
}
