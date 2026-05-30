type EnvKey =
  | "AUTH_SECRET"
  | "CAMP_LIBRARY_API_TOKEN"
  | "CAMP_LIBRARY_API_URL"
  | "CLERK_SECRET_KEY"
  | "CLERK_WEBHOOK_SECRET"
  | "CLOUDFLARE_ACCOUNT_ID"
  | "CLOUDFLARE_API_TOKEN"
  | "CLOUDFLARE_D1_DATABASE_ID"
  | "DATABASE_URL"
  | "NEXT_PUBLIC_APP_URL"
  | "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";

export const REQUIRED_SERVER_ENV = ["AUTH_SECRET"] as const satisfies readonly EnvKey[];

export const OPTIONAL_SERVER_ENV = [
  "CAMP_LIBRARY_API_TOKEN",
  "CAMP_LIBRARY_API_URL",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_D1_DATABASE_ID",
  "DATABASE_URL",
] as const satisfies readonly EnvKey[];

export const PUBLIC_ENV = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
] as const satisfies readonly EnvKey[];

type EnvStatus = {
  key: EnvKey;
  present: boolean;
};

const PLACEHOLDER_RE = /^(|<.*>|.*placeholder.*|changeme|change-me|example|replace-me|todo|your-.+)$/i;

function isConfigured(key: EnvKey, value: string | undefined): value is string {
  if (value == null) return false;
  const trimmed = value.trim();
  if (PLACEHOLDER_RE.test(trimmed)) return false;
  if (key === "AUTH_SECRET" && trimmed.length < 32) return false;
  return true;
}

function statusFor(keys: readonly EnvKey[]): EnvStatus[] {
  return keys.map((key) => ({
    key,
    present: isConfigured(key, process.env[key]),
  }));
}

function missingFrom(statuses: readonly EnvStatus[]): EnvKey[] {
  return statuses.filter((item) => !item.present).map((item) => item.key);
}

export function getRequiredServerEnv(key: (typeof REQUIRED_SERVER_ENV)[number]): string {
  const value = process.env[key];
  if (!isConfigured(key, value)) {
    throw new Error(`Missing required server environment variable: ${key}`);
  }
  return value;
}

export function getOptionalServerEnv(key: (typeof OPTIONAL_SERVER_ENV)[number]): string | undefined {
  const value = process.env[key];
  return isConfigured(key, value) ? value : undefined;
}

export function getPublicEnv(key: (typeof PUBLIC_ENV)[number]): string | undefined {
  const value = process.env[key];
  return isConfigured(key, value) ? value : undefined;
}

export function getBackendEnvStatus() {
  const required = statusFor(REQUIRED_SERVER_ENV);
  const optional = statusFor(OPTIONAL_SERVER_ENV);
  const publicVars = statusFor(PUBLIC_ENV);
  const missingRequired = missingFrom(required);

  const hasCloudflareBridge =
    isConfigured("CAMP_LIBRARY_API_URL", process.env.CAMP_LIBRARY_API_URL) &&
    isConfigured("CAMP_LIBRARY_API_TOKEN", process.env.CAMP_LIBRARY_API_TOKEN);

  const hasClerkAuth =
    isConfigured("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    isConfigured("CLERK_SECRET_KEY", process.env.CLERK_SECRET_KEY);

  return {
    ready: missingRequired.length === 0,
    required,
    optional,
    public: publicVars,
    missingRequired,
    capabilities: {
      authSecret: isConfigured("AUTH_SECRET", process.env.AUTH_SECRET),
      clerkAuth: hasClerkAuth,
      cloudflareBridge: hasCloudflareBridge,
      database: isConfigured("DATABASE_URL", process.env.DATABASE_URL),
    },
  };
}
