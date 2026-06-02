/**
 * Base error for all Modaic SDK failures.
 */
export class ModaicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModaicError";
  }
}

/**
 * Raised when no access token is available, or the token is rejected by the hub.
 */
export class AuthenticationError extends ModaicError {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Raised when a repository that is expected to exist cannot be found on the hub.
 */
export class RepositoryNotFoundError extends ModaicError {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryNotFoundError";
  }
}

/**
 * Raised when creating a repository that already exists and `exist_ok` is false.
 */
export class RepositoryExistsError extends ModaicError {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryExistsError";
  }
}
