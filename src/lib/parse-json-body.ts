/** Parse a JSON request body as a plain object (rejects null, arrays, primitives). */
export async function parseJsonObject(
  req: Request,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "invalid JSON body" }, { status: 400 }),
    };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: Response.json({ error: "invalid JSON body" }, { status: 400 }),
    };
  }
  return { ok: true, body: body as Record<string, unknown> };
}
