import { deviceFromRequest, json } from "@/server/auth";
import { pullChanges } from "@/server/sync";

export async function GET(req: Request) {
  const device = deviceFromRequest(req);
  if (!device) return json({ error: "Unauthorized device" }, 401);
  const url = new URL(req.url);
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0) || 0);
  try {
    return json(await pullChanges(cursor));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
