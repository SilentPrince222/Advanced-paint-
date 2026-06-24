/**
 * Split raw SQL into executable statements. Tracks dollar-quoted (`$$ … $$`)
 * blocks and single-quoted string literals so `;` and `--` inside them are
 * not treated as terminators / comments.
 */
export function splitSqlStatements(raw: string): string[] {
  const cleaned = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const statements: string[] = [];
  let current = "";
  let inDollar = false;
  let inString = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;

    if (!inString && ch === "$" && cleaned[i + 1] === "$") {
      inDollar = !inDollar;
      current += "$$";
      i++;
      continue;
    }

    if (!inDollar && ch === "'") {
      inString = !inString;
      current += ch;
      continue;
    }

    if (!inDollar && !inString && ch === "-" && cleaned[i + 1] === "-") {
      while (i < cleaned.length && cleaned[i] !== "\n") i++;
      continue;
    }

    if (ch === ";" && !inDollar && !inString) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
