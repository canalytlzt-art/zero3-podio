export function isCancelledProofMark(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return false;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

export function cancelledProofLabel(status: string, value: number | string | null | undefined): string | null {
  if (!isCancelledProofMark(value)) return null;
  if (status === "VALIDATED") return "Prova cancelada · regra de pontuação pendente";
  if (status === "PROVISIONAL") return "Prova cancelada · provisório, aguarda revisão";
  return "Prova cancelada";
}

export function cancelledProofValueLabel(
  status: string,
  value: number | string | null | undefined,
  unit?: string | null,
): string | null {
  const label = cancelledProofLabel(status, value);
  if (!label || value === null || value === undefined) return null;
  return `${value}${unit ? ` ${unit}` : ""} · ${label}`;
}
