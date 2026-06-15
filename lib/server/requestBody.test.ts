import { describe, expect, it } from "vitest";
import { clientIpFrom, parseJsonObject, readTextBodyWithLimit } from "./requestBody";

describe("limited request body reading", () => {
  it("rejects bodies that exceed the byte cap without relying on Content-Length", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(32) }),
    });

    await expect(readTextBodyWithLimit(request, 16)).resolves.toBeNull();
  });

  it("uses Content-Length as an early rejection but still reads valid bodies", async () => {
    const accepted = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": "13" },
      body: '{"ok":true}',
    });
    const rejected = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": "99" },
      body: "{}",
    });

    await expect(readTextBodyWithLimit(accepted, 32)).resolves.toBe('{"ok":true}');
    await expect(readTextBodyWithLimit(rejected, 32)).resolves.toBeNull();
  });

  it("parses only JSON objects", () => {
    expect(parseJsonObject('{"code":"abc"}')).toEqual({ code: "abc" });
    expect(parseJsonObject("[1,2,3]")).toEqual({});
    expect(parseJsonObject("not json")).toEqual({});
  });
});

describe("clientIpFrom", () => {
  function reqWith(headers: Record<string, string>) {
    return new Request("https://example.test", { headers });
  }

  it("prefers the trusted edge header over X-Forwarded-For", () => {
    const request = reqWith({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-real-ip": "10.0.0.1",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    expect(clientIpFrom(request)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then the first X-Forwarded-For hop", () => {
    expect(clientIpFrom(reqWith({ "x-real-ip": "10.0.0.2" }))).toBe("10.0.0.2");
    expect(clientIpFrom(reqWith({ "x-forwarded-for": "  9.9.9.9 , 8.8.8.8 " }))).toBe("9.9.9.9");
  });

  it("returns null when no source header is present or the value is absurd", () => {
    expect(clientIpFrom(reqWith({}))).toBeNull();
    expect(clientIpFrom(reqWith({ "x-real-ip": "x".repeat(65) }))).toBeNull();
  });
});
