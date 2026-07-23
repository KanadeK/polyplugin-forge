const DEFAULT_NAME = "friend";
const MAX_NAME_LENGTH = 80;

export function normalizeName(value) {
  if (typeof value !== "string") {
    return DEFAULT_NAME;
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length === 0
    ? DEFAULT_NAME
    : normalized.slice(0, MAX_NAME_LENGTH);
}

export function createGreeting(value) {
  return `Hello, ${normalizeName(value)}!`;
}
