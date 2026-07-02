import { prisma } from "@/lib/db";
import crypto from "node:crypto";

function h(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function main() {
  const rt = await prisma.oAuthRefreshToken.findUnique({ 
    where: { tokenHash: h("mcpr_c3bsmokert0000123456789012345") }, 
    select: { revokedAt: true, id: true } 
  });
  console.log("RT revokedAt:", rt?.revokedAt ?? "null (NOT revoked)");

  const at = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash: h("mcpa_c3bsmoketoken000123456789012") },
    select: { revokedAt: true },
  });
  console.log("AT revokedAt:", at?.revokedAt ?? "null (NOT revoked)");
}

main().catch(console.error).finally(() => prisma.$disconnect());
