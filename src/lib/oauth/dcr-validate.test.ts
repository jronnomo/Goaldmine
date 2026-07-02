// src/lib/oauth/dcr-validate.test.ts
//
// Unit tests for the C-1 DCR body validator (dcr-validate.ts).
// Pure module — no DB. Uses vi.stubEnv for ALLOWED_REDIRECT_HOSTS.

import { describe, it, expect, vi, afterEach } from "vitest";
import { dcrValidate } from "@/lib/oauth/dcr-validate";

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function validBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    client_name: "Claude",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Table-driven cases
// ---------------------------------------------------------------------------

describe("dcrValidate — valid bodies", () => {
  it("accepts a well-formed claude.ai body", () => {
    const result = dcrValidate(validBody());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirectUris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
    expect(result.clientName).toBe("Claude");
    expect(result.tokenEndpointAuthMethod).toBe("none");
  });

  it("accepts claude.com redirect_uri", () => {
    const result = dcrValidate(
      validBody({ redirect_uris: ["https://claude.com/callback"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a claude.ai subdomain redirect_uri", () => {
    const result = dcrValidate(
      validBody({ redirect_uris: ["https://sub.claude.ai/callback"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts localhost http redirect_uri (native client)", () => {
    const result = dcrValidate(
      validBody({ redirect_uris: ["http://localhost:8080/callback"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts localhost https redirect_uri", () => {
    const result = dcrValidate(
      validBody({ redirect_uris: ["https://localhost/callback"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts 127.0.0.1 http redirect_uri", () => {
    const result = dcrValidate(
      validBody({ redirect_uris: ["http://127.0.0.1:3000/cb"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts token_endpoint_auth_method: 'none'", () => {
    const result = dcrValidate(
      validBody({ token_endpoint_auth_method: "none" }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts absent token_endpoint_auth_method", () => {
    const result = dcrValidate(validBody());
    expect(result.ok).toBe(true);
  });

  it("accepts absent client_name", () => {
    const result = dcrValidate({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clientName).toBeUndefined();
  });

  it("trims client_name whitespace", () => {
    const result = dcrValidate(validBody({ client_name: "  Claude  " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clientName).toBe("Claude");
  });

  it("accepts multiple redirect_uris (≤10)", () => {
    const result = dcrValidate(
      validBody({
        redirect_uris: [
          "https://claude.ai/callback1",
          "https://claude.ai/callback2",
          "http://localhost:3000/cb",
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts ALLOWED_REDIRECT_HOSTS env extension", () => {
    vi.stubEnv("ALLOWED_REDIRECT_HOSTS", "my-app.example.com");
    const result = dcrValidate(
      validBody({ redirect_uris: ["https://my-app.example.com/callback"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a subdomain of an ALLOWED_REDIRECT_HOSTS entry", () => {
    vi.stubEnv("ALLOWED_REDIRECT_HOSTS", "example.com");
    const result = dcrValidate(
      validBody({ redirect_uris: ["https://sub.example.com/cb"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores unknown fields (RFC 7591 §2)", () => {
    const result = dcrValidate(
      validBody({ unknown_field: "ignored", another: 42 }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("dcrValidate — invalid bodies (errors)", () => {
  it("rejects null body", () => {
    const result = dcrValidate(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_client_metadata");
  });

  it("rejects a non-object body (string)", () => {
    const result = dcrValidate("not-an-object");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error).toBe("invalid_client_metadata");
  });

  it("rejects an array body", () => {
    const result = dcrValidate([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error).toBe("invalid_client_metadata");
  });

  it("rejects empty redirect_uris array", () => {
    const result = dcrValidate(validBody({ redirect_uris: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_redirect_uri");
  });

  it("rejects missing redirect_uris", () => {
    const result = dcrValidate({ client_name: "Claude" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error).toBe("invalid_redirect_uri");
  });

  it("rejects more than 10 redirect_uris", () => {
    const uris = Array.from({ length: 11 }, (_, i) => `https://claude.ai/cb${i}`);
    const result = dcrValidate(validBody({ redirect_uris: uris }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error).toBe("invalid_redirect_uri");
  });

  it("rejects evil.com https redirect_uri (not in allowed list)", () => {
    const result = dcrValidate(
      validBody({ redirect_uris: ["https://evil.com/callback"] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_redirect_uri");
  });

  it("rejects http for a non-localhost host", () => {
    const result = dcrValidate(
      validBody({ redirect_uris: ["http://claude.ai/callback"] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error).toBe("invalid_redirect_uri");
  });

  it("rejects token_endpoint_auth_method: 'client_secret_basic'", () => {
    const result = dcrValidate(
      validBody({ token_endpoint_auth_method: "client_secret_basic" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_client_metadata");
  });

  it("rejects token_endpoint_auth_method: 'client_secret_post'", () => {
    const result = dcrValidate(
      validBody({ token_endpoint_auth_method: "client_secret_post" }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects client_name exceeding 120 characters", () => {
    const longName = "A".repeat(121);
    const result = dcrValidate(validBody({ client_name: longName }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error).toBe("invalid_client_metadata");
  });

  it("accepts client_name of exactly 120 characters", () => {
    const name120 = "A".repeat(120);
    const result = dcrValidate(validBody({ client_name: name120 }));
    expect(result.ok).toBe(true);
  });

  it("rejects evil.com even when ALLOWED_REDIRECT_HOSTS targets another domain", () => {
    vi.stubEnv("ALLOWED_REDIRECT_HOSTS", "safe.example.com");
    const result = dcrValidate(
      validBody({ redirect_uris: ["https://evil.com/callback"] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a non-string entry in redirect_uris", () => {
    const result = dcrValidate(
      validBody({ redirect_uris: [42] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.body.error).toBe("invalid_redirect_uri");
  });
});
