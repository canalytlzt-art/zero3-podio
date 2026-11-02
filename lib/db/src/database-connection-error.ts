export const DATABASE_CONNECTION_UNAVAILABLE_CODE =
  "DATABASE_CONNECTION_UNAVAILABLE";

export class DatabaseConnectionUnavailableError extends Error {
  readonly code = DATABASE_CONNECTION_UNAVAILABLE_CODE;

  constructor(cause: unknown) {
    super("Could not acquire a PostgreSQL connection.", { cause });
    this.name = "DatabaseConnectionUnavailableError";
  }
}
