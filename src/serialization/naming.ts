/**
 * Derive a PascalCase signature title from a repo path.
 *
 * The Python SDK uses the signature class name as the schema `title`; TS
 * signatures are anonymous, so we derive a stable title from the repo's name
 * segment.
 *
 * Examples:
 *   "modaic/quality-judge" -> "QualityJudge"
 *   "modaic/tyrin_judge"   -> "TyrinJudge"
 *   "my-judge"             -> "MyJudge"
 */
export function repoNameToTitle(repo: string): string {
  const name = repo.includes("/") ? repo.split("/").pop()! : repo;
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}
