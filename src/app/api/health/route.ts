import { getDb } from "@/server/db";
import { isInsecureConfig, json } from "@/server/auth";

export async function GET(req: Request) {
  void req.url; // request-time only
  try {
    const db = await getDb();
    await db.query("SELECT 1");
    return json({
      ok: true,
      storage: db.kind,
      durable: db.kind === "postgres" || !process.env.VERCEL,
      insecureDefaults: isInsecureConfig(),
      serverTime: Date.now(),
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 503);
  }
}
