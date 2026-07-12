type AuthRole = "editor" | "admin";

type AuthUser = {
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

// The site admin's email — the single account allowed to generate/manage staff
// invite codes. Read from the environment (NEXT_PUBLIC_ so the client can gate
// its admin UI, not just the server) and normalized to lowercase for comparison.
// Unset ⇒ empty ⇒ nobody is admin (fail-closed); set it in Vercel + .env.local.
export const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").trim().toLowerCase();

// Localhost development convenience: when the app is served from the local
// machine, every visitor is treated as a fully-privileged staff member without
// signing in. This is scoped strictly to loopback hostnames (see isLocalHost)
// so it can never apply to a deployed server such as camplibrary.com.
export const LOCAL_STAFF_SESSION: AuthSession = {
  status: "authenticated",
  user: {
    id: "local-staff",
    name: "Local staff",
    email: ADMIN_EMAIL,
    role: "admin",
  },
  mode: "preview",
  authenticatedAt: "1970-01-01T00:00:00.000Z",
};

// Loopback hosts only. The value is the request's Host header (which may carry a
// port, e.g. "localhost:3000"), so the port is stripped before comparison. IPv6
// loopback may arrive bracketed ("[::1]:3000") or bare ("::1").
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let hostname = host.trim().toLowerCase();
  if (!hostname) return false;

  // Strip a trailing port. For bracketed IPv6 ("[::1]:3000") take the bracketed
  // part; otherwise only treat a colon as a port separator when the host is not
  // a bare IPv6 address (which contains multiple colons).
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    hostname = end === -1 ? hostname.slice(1) : hostname.slice(1, end);
  } else if (hostname.indexOf(":") === hostname.lastIndexOf(":")) {
    hostname = hostname.split(":")[0];
  }

  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  // 127.0.0.0/8 is entirely loopback.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

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

function isUsableClerkKey(value: string | null | undefined): value is string {
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
  // Fail closed: with no ADMIN_EMAIL configured, no one is admin (never let an
  // empty/whitespace email match an empty ADMIN_EMAIL).
  return Boolean(ADMIN_EMAIL) && email?.trim().toLowerCase() === ADMIN_EMAIL;
}

function canEditLibrary(session: AuthSession): boolean {
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
