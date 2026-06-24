import { getDb } from "@/lib/db";
import { listExecLog } from "@/lib/flow-repo";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const list = await listExecLog(getDb(), id);
    return Response.json(list);
  } catch (e) {
    console.error("[GET /api/flows/:id/exec-log]", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
