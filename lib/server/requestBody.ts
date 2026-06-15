export async function readTextBodyWithLimit(request: Request, maxBytes: number): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const size = Number(contentLength);
    if (Number.isFinite(size) && size > maxBytes) return null;
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) return null;
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return new TextDecoder().decode(body);
}

export function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const MAX_CLIENT_IP_LENGTH = 64;

// Best-effort client IP for rate limiting. Prefers the headers a trusted edge
// (Vercel) sets to the real peer and the client cannot forge; only falls back to
// the left-most X-Forwarded-For entry. Returns null when nothing usable is
// present so callers can fail open rather than block.
export function clientIpFrom(request: Request): string | null {
  const candidate =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    null;
  if (!candidate) return null;
  const ip = candidate.trim().toLowerCase();
  if (!ip || ip.length > MAX_CLIENT_IP_LENGTH) return null;
  return ip;
}
