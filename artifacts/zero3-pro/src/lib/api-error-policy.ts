export function getHttpErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function shouldRetryZero3Query(failureCount: number, error: unknown): boolean {
  const status = getHttpErrorStatus(error);
  if (status === 401 || status === 403 || status === 501) return false;
  return failureCount < 1;
}

export function pollingIntervalAfterError(error: unknown, intervalMs: number): number | false {
  return getHttpErrorStatus(error) === 501 ? false : intervalMs;
}

export function shouldRefetchAfterError(error: unknown): boolean {
  return getHttpErrorStatus(error) !== 501;
}

export function queryErrorMessage(error: unknown): string {
  if (getHttpErrorStatus(error) === 501) {
    return "A API respondeu HTTP 501: esta operação ainda não está disponível no servidor.";
  }
  return "Não foi possível conectar aos dados da operação.";
}
