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

export function isAdminEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === ADMIN_EMAIL;
}

export function canEditLibrary(session: AuthSession): boolean {
  return session.status === "authenticated";
}
