import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE_NAME = "lm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MIN_SESSION_SECRET_LENGTH = 32;

type SessionPayload = {
  uid: string;
  exp: number;
};

type SessionUser = {
  id: string;
  email: string;
  organizationId: string;
  role: "OWNER" | "MANAGER" | "LINKBUILDER";
};

export type SessionRole = SessionUser["role"];

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= MIN_SESSION_SECRET_LENGTH) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `SESSION_SECRET must be set and at least ${MIN_SESSION_SECRET_LENGTH} characters in production`
    );
  }
  return "dev-only-insecure-session-secret-change-me";
}

function toBase64Url(input: Buffer | string) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buffer.toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payloadBase64: string) {
  return toBase64Url(
    crypto.createHmac("sha256", getSessionSecret()).update(payloadBase64).digest()
  );
}

function createSessionToken(userId: string) {
  const payload: SessionPayload = {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return null;

  const expectedSignature = signPayload(payloadBase64);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);

  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadBase64)) as SessionPayload;
    if (!payload?.uid || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function scryptHash(password: string, salt: string) {
  return await new Promise<string>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve((derivedKey as Buffer).toString("hex"));
    });
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptHash(password, salt);
  return `scrypt:${salt}:${hash}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const parts = passwordHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, salt, storedHash] = parts;
  const computedHash = await scryptHash(password, salt);

  const left = Buffer.from(storedHash, "hex");
  const right = Buffer.from(computedHash, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function applySessionCookie(response: NextResponse, userId: string) {
  const token = createSessionToken(userId);
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: {
      id: true,
      email: true,
      organizationId: true,
      role: true,
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    organizationId: user.organizationId,
    role: user.role,
  };
}

export async function requireApiUser() {
  const user = await getSessionUser();
  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return {
    user,
    error: null,
  };
}

export function userHasRole(userRole: SessionRole, allowedRoles: readonly SessionRole[]) {
  return allowedRoles.includes(userRole);
}

export function requireApiRole(
  userRole: SessionRole,
  allowedRoles: readonly SessionRole[]
) {
  if (!userHasRole(userRole, allowedRoles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
