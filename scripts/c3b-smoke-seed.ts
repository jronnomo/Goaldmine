/**
 * C-3b smoke test: seed a test access+refresh token pair for the founder.
 * Run: npx tsx --env-file .env scripts/c3b-smoke-seed.ts
 * Clean up: npx tsx --env-file .env scripts/c3b-smoke-seed.ts --cleanup
 */
import { prisma } from "@/lib/db";
import crypto from "node:crypto";

const hashSecret = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const TEST_CLIENT_ID = "mcp_c3bsmokeclient0001";
export const TEST_AT_PLAIN = "mcpa_c3bsmoketoken000123456789012";
export const TEST_RT_PLAIN = "mcpr_c3bsmokert0000123456789012345";
export const TEST_FAMILY_ID = "c3b-smoke-family-001";

const cleanup = process.argv.includes("--cleanup");

async function main() {
  const founder = await prisma.user.findFirst({ where: { email: "ggronnii@gmail.com" } });
  if (!founder) { console.error("No founder"); process.exit(1); }
  console.log("Founder userId:", founder.id);

  if (cleanup) {
    await prisma.oAuthAccessToken.deleteMany({ where: { clientId: TEST_CLIENT_ID } });
    await prisma.oAuthRefreshToken.deleteMany({ where: { clientId: TEST_CLIENT_ID } });
    await prisma.oAuthClient.deleteMany({ where: { clientId: TEST_CLIENT_ID } });
    console.log("Cleanup done");
    return;
  }

  await prisma.oAuthClient.upsert({
    where: { clientId: TEST_CLIENT_ID },
    create: {
      clientId: TEST_CLIENT_ID,
      clientName: "C-3b smoke test client",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      scope: "mcp",
    },
    update: {},
  });

  const atHash = hashSecret(TEST_AT_PLAIN);
  const at = await prisma.oAuthAccessToken.upsert({
    where: { tokenHash: atHash },
    create: {
      tokenHash: atHash,
      clientId: TEST_CLIENT_ID,
      userId: founder.id,
      resource: null,
      scope: "mcp",
      expiresAt: new Date(Date.now() + 3600 * 1000),
    },
    update: { revokedAt: null, expiresAt: new Date(Date.now() + 3600 * 1000) },
  });

  const rtHash = hashSecret(TEST_RT_PLAIN);
  const rt = await prisma.oAuthRefreshToken.upsert({
    where: { tokenHash: rtHash },
    create: {
      tokenHash: rtHash,
      clientId: TEST_CLIENT_ID,
      userId: founder.id,
      resource: null,
      scope: "mcp",
      familyId: TEST_FAMILY_ID,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
    update: { revokedAt: null },
  });

  console.log("AT id:", at.id, "revokedAt:", at.revokedAt);
  console.log("RT id:", rt.id, "revokedAt:", rt.revokedAt);
  console.log("\nAccess token (plaintext):", TEST_AT_PLAIN);
  console.log("Refresh token (plaintext):", TEST_RT_PLAIN);
}

main().catch(console.error).finally(() => prisma.$disconnect());
