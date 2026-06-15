import { describe, expect, it } from "vitest";
import { isPlayerEmbed, parseEmbed } from "./embed";

describe("parseEmbed — YouTube", () => {
  const id = "dQw4w9WgXcQ";
  it.each([
    "https://www.youtube.com/watch?v=" + id,
    "https://youtu.be/" + id,
    "https://youtube.com/watch?v=" + id + "&t=42s",
    "https://www.youtube.com/embed/" + id,
    "https://www.youtube.com/shorts/" + id,
    "https://m.youtube.com/watch?v=" + id,
    "youtube.com/watch?v=" + id, // schemeless
  ])("recognizes %s", (url) => {
    const parsed = parseEmbed(url);
    expect(parsed.kind).toBe("youtube");
    expect(parsed.embedUrl).toBe("https://www.youtube-nocookie.com/embed/" + id);
    expect(parsed.href).toBe("https://www.youtube.com/watch?v=" + id);
    expect(isPlayerEmbed(url)).toBe(true);
  });

  it("rejects a malformed video id and falls back to a link", () => {
    const parsed = parseEmbed("https://www.youtube.com/watch?v=not-an-id-too-long");
    expect(parsed.kind).toBe("link");
  });
});

describe("parseEmbed — Vimeo", () => {
  it("recognizes vimeo.com/<id> and player urls", () => {
    expect(parseEmbed("https://vimeo.com/76979871")).toMatchObject({
      kind: "vimeo",
      embedUrl: "https://player.vimeo.com/video/76979871",
      href: "https://vimeo.com/76979871",
    });
    expect(parseEmbed("https://player.vimeo.com/video/76979871").kind).toBe("vimeo");
  });
});

describe("parseEmbed — link cards", () => {
  it("treats a normal site as a link with a bare domain", () => {
    const parsed = parseEmbed("https://www.example.com/craft/macrame");
    expect(parsed.kind).toBe("link");
    expect(parsed.domain).toBe("example.com");
    expect(parsed.href).toBe("https://www.example.com/craft/macrame");
  });

  it("upgrades a schemeless link to https", () => {
    expect(parseEmbed("example.com/page")).toMatchObject({ kind: "link", domain: "example.com" });
  });
});

describe("parseEmbed — safety", () => {
  it.each(["", "   ", "not a url", "javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"])(
    "returns kind none for unsafe/empty input %j",
    (raw) => {
      expect(parseEmbed(raw).kind).toBe("none");
      expect(isPlayerEmbed(raw)).toBe(false);
    }
  );
});
