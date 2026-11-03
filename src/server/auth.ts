import "server-only";
import crypto from "node:crypto";

export interface DeviceToken {
  d: string; // device id
  c: string; // device code
  iat: number;
}

const DEV_SECRET = "pos-dev-secret-change-me";

export function authSecret(): string {
  return process.env.AUTH_SECRET || DEV_SECRET;
}

export function storeAccessCode(): string {
  return process.env.STORE_ACCESS_CODE || "demo";
}

export function isInsecureConfig(): boolean {
  return !process.env.AUTH_SECRET || !process.env.STORE_ACCESS_CODE;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export function signToken(payload: DeviceToken): string {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string | null | undefined): DeviceToken | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DeviceToken;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function deviceFromRequest(req: Request): DeviceToken | null {
  const h = req.headers.get("authorization");
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
  return verifyToken(token);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
