import { prisma } from "@/lib/db";

async function main() {
  const founder = await prisma.user.findFirst({ where: { email: "ggronnii@gmail.com" } });
  if (!founder) { console.error("No founder"); process.exit(1); }
  
  const count = await prisma.oAuthAccessToken.count({ where: { userId: founder.id } });
  console.log("Founder total access token count:", count);
}

main().catch(console.error).finally(() => prisma.$disconnect());
