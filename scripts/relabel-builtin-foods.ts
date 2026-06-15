// Relabel cached FoodLibrary rows sourced from the builtin table so their stored
// name carries the prep state (e.g. "Chicken Breast" → "Chicken Breast (cooked)").
// The resolver already labels NEWLY-resolved builtins; this catches rows cached
// before that change so chips / search / future picks show the prep too.
//
// Dry-run by default (prints planned changes). Pass --apply to write.
//   npx tsx scripts/relabel-builtin-foods.ts          # dry run
//   npx tsx scripts/relabel-builtin-foods.ts --apply  # commit
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { builtinDisplayName } from "../src/lib/food-builtins";

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.foodLibrary.findMany({
    where: { barcode: { startsWith: "builtin:" } },
    select: { id: true, name: true, barcode: true },
    orderBy: { name: "asc" },
  });

  const changes = rows
    .map((r) => {
      const slug = (r.barcode ?? "").slice("builtin:".length);
      const newName = builtinDisplayName(slug);
      return { id: r.id, slug, from: r.name, to: newName };
    })
    .filter((c) => c.to && c.to !== c.from);

  console.log(`builtin-sourced rows: ${rows.length} | would relabel: ${changes.length}\n`);
  for (const c of changes) console.log(`  "${c.from}"  →  "${c.to}"`);

  if (!apply) {
    console.log(`\n(dry run — re-run with --apply to write ${changes.length} change(s))`);
    return;
  }
  for (const c of changes) {
    await prisma.foodLibrary.update({ where: { id: c.id }, data: { name: c.to } });
  }
  console.log(`\n✓ applied ${changes.length} relabel(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
