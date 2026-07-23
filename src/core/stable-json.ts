function normalize(value: unknown, seen: Set<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("Cannot serialize a cyclic array");
    }
    seen.add(value);
    const result = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return result;
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("Cannot serialize a cyclic object");
    }
    seen.add(value);
    const record = value as Record<string, unknown>;
    const result = Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, normalize(record[key], seen)])
    );
    seen.delete(value);
    return result;
  }

  return value;
}

export function stableJson(value: unknown, indentation = 2): string {
  return `${JSON.stringify(normalize(value, new Set()), null, indentation)}\n`;
}
