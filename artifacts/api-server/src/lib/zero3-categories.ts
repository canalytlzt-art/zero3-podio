const BUILT_IN_CATEGORIES = ["SC", "RX"] as const;
const CATEGORY_LIMIT = 10;
const CATEGORY_NAME_LIMIT = 32;

export function normalizeCategoryName(value: string): string {
  const trimmed = value.trim();
  const builtIn = BUILT_IN_CATEGORIES.find(
    (category) => category.toLocaleLowerCase("en") === trimmed.toLocaleLowerCase("en"),
  );
  return builtIn ?? trimmed;
}

export function normalizeEventCategories(categories: readonly string[]): string[] {
  const normalized = categories.map(normalizeCategoryName);
  const seen = new Set<string>();
  const unique = normalized.filter((category) => {
    const key = category.toLocaleLowerCase("en");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [
    ...BUILT_IN_CATEGORIES.filter((category) => unique.includes(category)),
    ...unique.filter((category) => !BUILT_IN_CATEGORIES.includes(category as typeof BUILT_IN_CATEGORIES[number])),
  ];
}

export function validateEventCategories(categories: readonly string[]): string | null {
  if (categories.length < 1 || categories.length > CATEGORY_LIMIT) {
    return `Configure de 1 a ${CATEGORY_LIMIT} categorias por evento.`;
  }
  if (categories.some((category) => {
    const normalized = normalizeCategoryName(category);
    return normalized.length < 1 ||
      normalized.length > CATEGORY_NAME_LIMIT ||
      /[\u0000-\u001f\u007f]/u.test(normalized);
  })) {
    return `Cada categoria deve ter de 1 a ${CATEGORY_NAME_LIMIT} caracteres válidos.`;
  }
  if (new Set(categories.map((category) => normalizeCategoryName(category).toLocaleLowerCase("en"))).size !== categories.length) {
    return "A lista de categorias não pode conter duplicatas.";
  }
  return null;
}
