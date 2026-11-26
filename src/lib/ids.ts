import { createHash, randomBytes, randomUUID } from "node:crypto";

export const newId = () => randomUUID();

/** URL-safe random token for sessions, sign-in links and invite codes. */
export const newToken = (bytes = 24) => randomBytes(bytes).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#eab308", "#14b8a6", "#ef4444"];
export const pickColor = (n: number) => COLORS[n % COLORS.length];

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "member"
  );
}
