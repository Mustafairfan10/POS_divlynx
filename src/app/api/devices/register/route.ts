import { json, safeEqual, signToken, storeAccessCode } from "@/server/auth";
import { getDb } from "@/server/db";
import { registerDevice } from "@/server/sync";
import type { RegisterResponse } from "@/lib/types";

export async function POST(req: Request) {
  let body: { accessCode?: string; deviceId?: string; deviceName?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const accessCode = String(body.accessCode ?? "");
  const deviceId = String(body.deviceId ?? "").slice(0, 100);
  const deviceName = String(body.deviceName ?? "Device").slice(0, 60);
  if (!deviceId) return json({ error: "deviceId is required" }, 400);

  if (!safeEqual(accessCode, storeAccessCode())) {
    // Slow down brute-force attempts.
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Incorrect store access code" }, 401);
  }

  try {
    const { code, isNewStore } = await registerDevice(deviceId, deviceName);
    const db = await getDb();
    const res: RegisterResponse = {
      token: signToken({ d: deviceId, c: code, iat: Date.now() }),
      deviceId,
      deviceCode: code,
      isNewStore,
      storage: db.kind,
    };
    return json(res);
  } catch (e) {
    return json({ error: `Could not register device: ${(e as Error).message}` }, 500);
  }
}
