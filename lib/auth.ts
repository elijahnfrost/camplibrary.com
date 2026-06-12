export type AuthRole = "editor" | "admin";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
};

export type AuthSession =
  | {
      status: "authenticated";
      user: AuthUser;
      mode: "preview" | "provider";
      authenticatedAt: string;
    }
  | {
      status: "anonymous";
      user: null;
      mode: "none";
      authenticatedAt: null;
    };

export const ANONYMOUS_SESSION: AuthSession = {
  status: "anonymous",
  user: null,
  mode: "none",
  authenticatedAt: null,
};

export const ADMIN_EMAIL = "contact@elijahfrost.com";

const PLACEHOLDER_RE = /^(|<.*>|.*placeholder.*|changeme|change-me|example|replace-me|todo|your-.+)$/i;
const DUMMY_CLERK_MARKERS = [
  "pk_test_zm9vlwjhci0xmjmu",
  "sk_test_dgvzdhnly3jldgtlewzvcmxvy2fszgv2",
  "foo-bar-123.clerk.accounts.dev",
  "testsecretkeyforlocaldevonly",
  "localdevonly",
  "local-dev",
];

function decodeClerkPayload(value: string): string {
  const encoded = value.replace(/^pk_(?:test|live)_/, "").replace(/^sk_(?:test|live)_/, "").replace(/\$$/, "");
  if (!encoded || encoded === value) return value;

  const atobFn = globalThis.atob;
  if (typeof atobFn === "function") {
    try {
      return atobFn(encoded);
    } catch {
      return value;
    }
  }

  try {
    const buffer = (globalThis as typeof globalThis & { Buffer?: { from(input: string, encoding: "base64"): { toString(): string } } })
      .Buffer;
    return buffer?.from(encoded, "base64").toString() || value;
  } catch {
    return value;
  }
}

export function isUsableClerkKey(value: string | null | undefined): value is string {
  if (value == null) return false;
  const trimmed = value.trim();
  if (PLACEHOLDER_RE.test(trimmed)) return false;
  const raw = trimmed.toLowerCase();
  if (DUMMY_CLERK_MARKERS.some((marker) => raw.includes(marker))) return false;
  const decoded = decodeClerkPayload(trimmed).toLowerCase();
  return !DUMMY_CLERK_MARKERS.some((marker) => decoded.includes(marker));
}

export function isClerkPublicKeyUsable(
  value: string | null | undefined = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
): value is string {
  const trimmed = value?.trim();
  return Boolean(trimmed?.startsWith("pk_")) && isUsableClerkKey(trimmed);
}

export function isClerkSecretKeyUsable(value: string | null | undefined = process.env.CLERK_SECRET_KEY): value is string {
  const trimmed = value?.trim();
  return Boolean(trimmed?.startsWith("sk_")) && isUsableClerkKey(trimmed);
}

export function isClerkAuthUsable(): boolean {
  return isClerkPublicKeyUsable() && isClerkSecretKeyUsable();
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === ADMIN_EMAIL;
}

export function canEditLibrary(session: AuthSession): boolean {
  return session.status === "authenticated";
}

export type StaffActionGate =
  | { allowed: true }
  | {
      allowed: false;
      message: string;
      signInHref: string | null;
    };

type StaffActionGateOptions = {
  authEnabled: boolean;
  returnTo?: string | null;
  origin?: string;
};

function safeReturnPath(value: string | null | undefined, origin?: string): string {
  if (!value) return "/";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (!origin) return "/";

  try {
    const url = new URL(value);
    if (url.origin !== origin) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

export function signInHref(returnTo: string | null | undefined, origin: string): string {
  const safePath = safeReturnPath(returnTo, origin);
  const signInUrl = new URL("/", origin);
  signInUrl.searchParams.set("auth", "sign-in");
  signInUrl.searchParams.set("next", safePath);
  return signInUrl.toString();
}

export function staffActionGate(
  session: AuthSession,
  action: string,
  options: StaffActionGateOptions
): StaffActionGate {
  if (canEditLibrary(session)) return { allowed: true };

  const staffAction = action.trim() || "make staff changes";
  if (!options.authEnabled) {
    return {
      allowed: false,
      message: "Staff sign-in is not configured, so " + staffAction + " is unavailable.",
      signInHref: null,
    };
  }

  const origin = options.origin ?? "http://localhost";
  return {
    allowed: false,
    message: "Sign in as staff to " + staffAction + ".",
    signInHref: signInHref(options.returnTo, origin),
  };
}
