/** Parse ?branch= query param. Empty string is invalid; absent → default branch. */
export function parseBranchParam(
  url: string,
): { ok: true; branch: string | undefined } | { ok: false; response: Response } {
  const raw = new URL(url).searchParams.get("branch");
  if (raw === null) return { ok: true, branch: undefined };
  if (raw === "") {
    return {
      ok: false,
      response: Response.json({ error: "unknown branch" }, { status: 400 }),
    };
  }
  return { ok: true, branch: raw };
}
