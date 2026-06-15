// Camp Library — embed link parsing.
//
// A run-sheet "media" detail holds a plain URL. This pure module turns that URL
// into a safe, renderable embed: a YouTube/Vimeo player (built from a *validated*
// video id — never the raw user string), or, for anything else, a link card.
//
// Security stance: we never reflect arbitrary user HTML or arbitrary iframe srcs.
// Only http(s) URLs are honored; provider embed srcs are reconstructed from an
// id that matches a strict charset; everything else degrades to a plain link.

export type EmbedKind = "youtube" | "vimeo" | "link" | "none";

export interface ParsedEmbed {
  kind: EmbedKind;
  // For youtube/vimeo: the sandboxed player src we build ourselves.
  embedUrl?: string;
  // A safe, openable http(s) link (provider watch page or the original URL).
  href: string;
  // Bare hostname (no leading "www."), for the link card label.
  domain: string;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{6,12}$/;

// Parse a possibly-schemeless URL into a URL object, but only if it resolves to
// an http(s) origin. Returns null for empty input, junk, or unsafe schemes
// (javascript:, data:, file:, …).
function safeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? [trimmed] : ["https://" + trimmed];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      /* not a URL — fall through */
    }
  }
  return null;
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && YOUTUBE_ID.test(id) ? id : null;
  }
  const v = url.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;
  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
    return YOUTUBE_ID.test(parts[1]) ? parts[1] : null;
  }
  return null;
}

function vimeoId(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  // player.vimeo.com/video/<id> or vimeo.com/<id>
  const candidate = parts[0] === "video" ? parts[1] : parts[0];
  return candidate && VIMEO_ID.test(candidate) ? candidate : null;
}

export function parseEmbed(raw: string): ParsedEmbed {
  const url = safeUrl(raw || "");
  if (!url) return { kind: "none", href: "", domain: "" };

  const host = url.hostname.toLowerCase();
  const domain = bareHost(url);

  if (YOUTUBE_HOSTS.has(host)) {
    const id = youtubeId(url);
    if (id) {
      return {
        kind: "youtube",
        embedUrl: "https://www.youtube-nocookie.com/embed/" + id,
        href: "https://www.youtube.com/watch?v=" + id,
        domain: "youtube.com",
      };
    }
  }

  if (VIMEO_HOSTS.has(host)) {
    const id = vimeoId(url);
    if (id) {
      return {
        kind: "vimeo",
        embedUrl: "https://player.vimeo.com/video/" + id,
        href: "https://vimeo.com/" + id,
        domain: "vimeo.com",
      };
    }
  }

  return { kind: "link", href: url.href, domain };
}

// True when the URL resolves to a playable provider embed (used by the editor to
// show a player preview vs. a link card).
export function isPlayerEmbed(raw: string): boolean {
  const kind = parseEmbed(raw).kind;
  return kind === "youtube" || kind === "vimeo";
}
