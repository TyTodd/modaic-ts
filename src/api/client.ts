import { getApiUrl, getGitUrl } from "../config";
import {
  AuthenticationError,
  ModaicError,
  RepositoryExistsError,
} from "../exceptions";

/** User identity returned by the git host's `/api/v1/user` endpoint. */
export interface UserInfo {
  login: string;
  email: string;
  name: string;
}

/** A single chat message returned alongside a prediction. */
export interface ArbiterMessage {
  role: string;
  content: unknown;
}

/** The result of running a deployed Arbiter. */
export interface ArbiterPrediction {
  exampleId: string;
  predictionId: string;
  output: Record<string, unknown>;
  reasoning: string;
  messages: ArbiterMessage[];
}

/** Headers for the git host / repo-management endpoints (`Authorization: token <tok>`). */
function gitHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "ModaicTS/0.1",
  };
}

/** Headers for the Modaic REST API (`Authorization: Bearer <tok>`). */
function bearerHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function errorBody(res: Response): Promise<string> {
  try {
    // FastAPI surfaces errors under `detail`; some endpoints use `message`.
    // Read both so server errors aren't collapsed to a bare "HTTP 500".
    const data = (await res.json()) as { detail?: unknown; message?: string };
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : data.detail != null
          ? JSON.stringify(data.detail)
          : undefined;
    return detail ?? data.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Fetch the user info for an access token. Used to build the authenticated git
 * remote URL and to set the commit identity.
 */
export async function getUserInfo(token: string): Promise<UserInfo> {
  const url = `${getGitUrl()}/api/v1/user`;
  const res = await fetch(url, { headers: gitHeaders(token) });
  if (res.status === 401) {
    throw new AuthenticationError("Invalid access token or authentication failed");
  }
  if (!res.ok) {
    throw new ModaicError(`Failed to fetch user info: ${await errorBody(res)}`);
  }
  const data = (await res.json()) as {
    login: string;
    email: string;
    full_name: string;
  };
  return { login: data.login, email: data.email, name: data.full_name };
}

/**
 * Create a repo on the hub. Returns true if created, false if it already existed
 * (when `existOk`). Mirrors `ModaicClient.create_repo`.
 */
export async function createRepo(
  repo: string,
  opts: { private: boolean; existOk: boolean; token: string },
): Promise<boolean> {
  const [username, name] = repo.split("/", 2);
  if (!username || !name) {
    throw new ModaicError(`Invalid repo path '${repo}'. Expected 'owner/name'.`);
  }
  const payload = {
    username,
    name,
    description: "",
    private: opts.private,
    auto_init: true,
    default_branch: "main",
    trust_model: "default",
  };
  const res = await fetch(`${getApiUrl()}/api/v2/repos`, {
    method: "POST",
    headers: gitHeaders(opts.token),
    body: JSON.stringify(payload),
  });
  if (res.ok) return true;

  const message = await errorBody(res);
  if (res.status === 409 || res.status === 422 || message.toLowerCase().includes("already exists")) {
    if (opts.existOk) return false;
    throw new RepositoryExistsError(`Repository '${repo}' already exists`);
  }
  if (res.status === 401) {
    throw new AuthenticationError("Invalid access token or authentication failed");
  }
  if (res.status === 403) {
    throw new AuthenticationError("Access denied - insufficient permissions");
  }
  throw new ModaicError(`Failed to create repository: ${message}`);
}

/**
 * Run a deployed Arbiter against a single input via the Modaic API.
 * The server runs the LLM; this is a pure HTTP call. Mirrors
 * `POST /api/v2/arbiters/predictions`.
 */
export async function predict(args: {
  token: string;
  input: Record<string, unknown>;
  arbiterRepo: string;
  arbiterRevision: string;
  groundTruth?: Record<string, unknown> | null;
  groundReasoning?: string;
  computeConfidence?: boolean;
}): Promise<ArbiterPrediction> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const res = await fetch(`${getApiUrl()}/api/v2/arbiters/predictions`, {
      method: "POST",
      headers: bearerHeaders(args.token),
      body: JSON.stringify({
        input: args.input,
        arbiter_repo: args.arbiterRepo,
        arbiter_revision: args.arbiterRevision,
        ground_truth: args.groundTruth ?? null,
        ground_reasoning: args.groundReasoning ?? "",
        compute_confidence: args.computeConfidence ?? false,
      }),
      signal: controller.signal,
    });
    if (res.status === 401) {
      throw new AuthenticationError("Invalid access token or authentication failed");
    }
    if (!res.ok) {
      throw new ModaicError(`Prediction failed: ${await errorBody(res)}`);
    }
    const data = (await res.json()) as {
      example_id: string;
      prediction_id: string;
      output: Record<string, unknown>;
      reasoning: string;
      messages?: ArbiterMessage[];
    };
    return {
      exampleId: data.example_id,
      predictionId: data.prediction_id,
      output: data.output,
      reasoning: data.reasoning,
      messages: data.messages ?? [],
    };
  } finally {
    clearTimeout(timeout);
  }
}
