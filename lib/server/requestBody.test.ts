import { describe, expect, it } from "vitest";
import { parseJsonObject, readTextBodyWithLimit } from "./requestBody";

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
