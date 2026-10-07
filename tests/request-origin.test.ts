import { afterEach, describe, expect, it } from "vitest";
import { trustedBrowserRequest } from "@/lib/request-origin";

afterEach(() => { delete process.env.SPEECH_COACH_ALLOWED_ORIGIN; });

describe("trusted browser origins", () => {
  it("keeps loopback same-origin behavior", () => {
    expect(trustedBrowserRequest({ host: "127.0.0.1:3004", origin: "http://127.0.0.1:3004", method: "POST", remoteAddress: "127.0.0.1" })).toBe(true);
    expect(trustedBrowserRequest({ host: "127.0.0.1:3004", origin: "https://evil.example", method: "POST", remoteAddress: "127.0.0.1" })).toBe(false);
    expect(trustedBrowserRequest({ host: "127.0.0.1:3004", origin: "http://127.0.0.1:3004", method: "POST", remoteAddress: "192.0.2.4" })).toBe(false);
  });

  it("allows only the exact configured HTTPS host and origin", () => {
    process.env.SPEECH_COACH_ALLOWED_ORIGIN = "https://101.132.96.36";
    expect(trustedBrowserRequest({ host: "101.132.96.36", origin: "https://101.132.96.36", method: "POST", remoteAddress: "127.0.0.1" })).toBe(true);
    expect(trustedBrowserRequest({ host: "101.132.96.36", origin: "http://101.132.96.36", method: "POST", remoteAddress: "127.0.0.1" })).toBe(false);
    expect(trustedBrowserRequest({ host: "101.132.96.36", origin: "https://evil.example", method: "POST", remoteAddress: "127.0.0.1" })).toBe(false);
  });

  it("rejects malformed or non-HTTPS configured origins", () => {
    process.env.SPEECH_COACH_ALLOWED_ORIGIN = "http://101.132.96.36";
    expect(trustedBrowserRequest({ host: "101.132.96.36", origin: "http://101.132.96.36", method: "POST", remoteAddress: "127.0.0.1" })).toBe(false);
  });
});
