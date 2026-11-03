import { deviceFromRequest, json } from "@/server/auth";
import { pushMutations } from "@/server/sync";
import type { PushResponse } from "@/lib/types";

export async function POST(req: Request) {
  const device = deviceFromRequest(req);
  if (!device) return json({ error: "Unauthorized device" }, 401);

  let body: { mutations?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  try {
    const results = await pushMutations(body.mutations, device.d);
    const res: PushResponse = { results, serverTime: Date.now() };
    return json(res);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
