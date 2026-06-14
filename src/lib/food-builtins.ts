/**
 * food-builtins.ts — Curated reference table of ~50 high-frequency whole/simple foods.
 *
 * All per-100g macro values are standard USDA FoodData Central (FDC) values, rounded
 * to house rules (calories/sodiumMg integer; protein/carbs/fat/fiber 1-decimal g).
 * If a value is genuinely zero it is stored as 0, not null.
 * Null is reserved for values that are truly unknown (no USDA data) — these foods are
 * omitted from the table per design spec ("if unsure of a food's numbers, OMIT").
 *
 * Portion weights follow USDA Reference Amounts Customarily Consumed (RACC) and
 * FDC foodMeasures where available.  Natural units (1 egg, 1 slice, 1 tbsp…) are
 * expressed in grams.
 */

import type { FoodMacros } from "@/lib/food-types";

export type BuiltinFood = {
  slug: string;
  /** Lowercase aliases used for query matching (do not include slug itself). */
  aliases: string[];
  /** USDA per-100 g macros. */
  per100g: FoodMacros;
  portions: { key: string; label: string; grams: number }[];
  /** Key of the portion used when no explicit size/weight is given. */
  defaultPortionKey: string;
};

// ---------------------------------------------------------------------------
// Macro helpers – keep construction concise
// ---------------------------------------------------------------------------
function m(
  calories: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  fiberG: number,
  sodiumMg: number,
): FoodMacros {
  return { calories, proteinG, carbsG, fatG, fiberG, sodiumMg };
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export const BUILTINS: BuiltinFood[] = [
  // ── Fruits ────────────────────────────────────────────────────────────────
  {
    slug: "banana",
    aliases: ["bananas", "ripe banana", "plantain"],
    per100g: m(89, 1.1, 22.8, 0.3, 2.6, 1),
    portions: [
      { key: "small", label: "small (101 g)", grams: 101 },
      { key: "medium", label: "medium (118 g)", grams: 118 },
      { key: "large", label: "large (136 g)", grams: 136 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "apple",
    aliases: ["apples", "gala apple", "fuji apple", "honeycrisp apple", "granny smith apple"],
    per100g: m(52, 0.3, 13.8, 0.2, 2.4, 1),
    portions: [
      { key: "small", label: "small (149 g)", grams: 149 },
      { key: "medium", label: "medium (182 g)", grams: 182 },
      { key: "large", label: "large (223 g)", grams: 223 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "orange",
    aliases: ["oranges", "navel orange", "mandarin", "clementine", "tangerine"],
    per100g: m(47, 0.9, 11.8, 0.1, 2.4, 0),
    portions: [
      { key: "small", label: "small (96 g)", grams: 96 },
      { key: "medium", label: "medium (131 g)", grams: 131 },
      { key: "large", label: "large (184 g)", grams: 184 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "blueberries",
    aliases: ["blueberry", "wild blueberries"],
    per100g: m(57, 0.7, 14.5, 0.3, 2.4, 1),
    portions: [
      { key: "0.5cup", label: "½ cup (74 g)", grams: 74 },
      { key: "1cup", label: "1 cup (148 g)", grams: 148 },
      { key: "1oz", label: "1 oz (28 g)", grams: 28 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "strawberries",
    aliases: ["strawberry", "fresh strawberries"],
    per100g: m(32, 0.7, 7.7, 0.3, 2.0, 1),
    portions: [
      { key: "0.5cup", label: "½ cup (76 g)", grams: 76 },
      { key: "1cup", label: "1 cup (152 g)", grams: 152 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "grapes",
    aliases: ["grape", "red grapes", "green grapes", "black grapes"],
    per100g: m(69, 0.7, 18.1, 0.2, 0.9, 2),
    portions: [
      { key: "0.5cup", label: "½ cup (46 g)", grams: 46 },
      { key: "1cup", label: "1 cup (92 g)", grams: 92 },
      { key: "1oz", label: "1 oz (28 g)", grams: 28 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "mango",
    aliases: ["mangos", "mangoes", "fresh mango"],
    per100g: m(60, 0.8, 15.0, 0.4, 1.6, 1),
    portions: [
      { key: "small", label: "small (130 g)", grams: 130 },
      { key: "medium", label: "medium (175 g)", grams: 175 },
      { key: "large", label: "large (230 g)", grams: 230 },
      { key: "1cup", label: "1 cup cubed (165 g)", grams: 165 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "peach",
    aliases: ["peaches", "fresh peach", "nectarine"],
    per100g: m(39, 0.9, 9.5, 0.3, 1.5, 0),
    portions: [
      { key: "small", label: "small (130 g)", grams: 130 },
      { key: "medium", label: "medium (175 g)", grams: 175 },
      { key: "large", label: "large (224 g)", grams: 224 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "pineapple",
    aliases: ["pineapples", "fresh pineapple"],
    per100g: m(50, 0.5, 13.1, 0.1, 1.4, 1),
    portions: [
      { key: "0.5cup", label: "½ cup chunks (83 g)", grams: 83 },
      { key: "1cup", label: "1 cup chunks (165 g)", grams: 165 },
      { key: "2cups", label: "2 cups chunks (330 g)", grams: 330 },
    ],
    defaultPortionKey: "1cup",
  },

  // ── Animal Proteins ───────────────────────────────────────────────────────
  {
    slug: "egg",
    aliases: ["eggs", "whole egg", "whole eggs", "large egg", "large eggs"],
    // USDA: Egg, whole, raw, fresh — 143 kcal / 100 g
    per100g: m(143, 12.6, 0.7, 9.5, 0.0, 142),
    portions: [
      { key: "small", label: "1 small egg (38 g)", grams: 38 },
      { key: "medium", label: "1 medium egg (44 g)", grams: 44 },
      { key: "large", label: "1 large egg (50 g)", grams: 50 },
      { key: "xlarge", label: "1 extra-large egg (56 g)", grams: 56 },
    ],
    defaultPortionKey: "large",
  },
  {
    slug: "egg-white",
    aliases: ["egg white", "egg whites", "egg-white", "egg-whites", "eggwhite", "eggwhites"],
    // USDA: Egg, white, raw, fresh — 52 kcal / 100 g
    per100g: m(52, 10.9, 0.7, 0.2, 0.0, 166),
    portions: [
      { key: "small", label: "1 small egg white (26 g)", grams: 26 },
      { key: "medium", label: "1 medium egg white (30 g)", grams: 30 },
      { key: "large", label: "1 large egg white (33 g)", grams: 33 },
      { key: "xlarge", label: "1 extra-large egg white (37 g)", grams: 37 },
    ],
    // Default to one large egg white (a natural "piece"), NOT 100 g — so a
    // count like "7 egg whites" scales by ~33 g/each (231 g), not 7 × 100 g.
    defaultPortionKey: "large",
  },
  {
    slug: "chicken-breast",
    aliases: [
      "chicken breast",
      "chicken breasts",
      "grilled chicken",
      "baked chicken",
      "cooked chicken breast",
    ],
    // USDA: Chicken, broiler or fryers, breast, meat only, cooked, roasted
    per100g: m(165, 31.0, 0.0, 3.6, 0.0, 74),
    portions: [
      { key: "small", label: "small (113 g / 4 oz)", grams: 113 },
      { key: "medium", label: "medium (170 g / 6 oz)", grams: 170 },
      { key: "large", label: "large (227 g / 8 oz)", grams: 227 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "ground-beef-90-10",
    aliases: ["ground beef", "ground beef 90/10", "lean ground beef", "93/7 ground beef", "ground turkey"],
    // USDA: Beef, ground, 90% lean / 10% fat, raw
    per100g: m(176, 20.5, 0.0, 10.1, 0.0, 72),
    portions: [
      { key: "3oz", label: "3 oz (85 g)", grams: 85 },
      { key: "4oz", label: "4 oz (113 g)", grams: 113 },
      { key: "6oz", label: "6 oz (170 g)", grams: 170 },
      { key: "8oz", label: "8 oz (227 g)", grams: 227 },
    ],
    defaultPortionKey: "4oz",
  },
  {
    slug: "salmon",
    aliases: ["salmon fillet", "atlantic salmon", "wild salmon", "sockeye salmon"],
    // USDA: Fish, salmon, Atlantic, farmed, raw
    per100g: m(142, 19.8, 0.0, 6.3, 0.0, 44),
    portions: [
      { key: "small", label: "small (85 g / 3 oz)", grams: 85 },
      { key: "medium", label: "medium (113 g / 4 oz)", grams: 113 },
      { key: "large", label: "large (170 g / 6 oz)", grams: 170 },
      { key: "fillet", label: "fillet (170 g)", grams: 170 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "tuna-canned",
    aliases: ["tuna", "canned tuna", "tuna in water", "albacore tuna", "chunk light tuna"],
    // USDA: Fish, tuna, light, canned in water, drained
    per100g: m(116, 25.5, 0.0, 0.8, 0.0, 325),
    portions: [
      { key: "0.5can", label: "½ can (71 g)", grams: 71 },
      { key: "1can", label: "1 can (142 g)", grams: 142 },
      { key: "3oz", label: "3 oz (85 g)", grams: 85 },
    ],
    defaultPortionKey: "1can",
  },
  {
    slug: "shrimp",
    aliases: ["shrimp cooked", "cooked shrimp", "shrimps", "prawns"],
    // USDA: Crustaceans, shrimp, mixed species, cooked, moist heat
    per100g: m(99, 24.0, 0.2, 1.1, 0.0, 224),
    portions: [
      { key: "small", label: "small (85 g / 3 oz)", grams: 85 },
      { key: "medium", label: "medium (113 g / 4 oz)", grams: 113 },
      { key: "large", label: "large (170 g / 6 oz)", grams: 170 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "turkey-breast",
    aliases: ["turkey", "roasted turkey", "turkey breast meat", "sliced turkey"],
    // USDA: Turkey, breast, meat only, cooked, roasted
    per100g: m(161, 29.9, 0.0, 3.2, 0.0, 77),
    portions: [
      { key: "small", label: "small (85 g / 3 oz)", grams: 85 },
      { key: "medium", label: "medium (113 g / 4 oz)", grams: 113 },
      { key: "large", label: "large (170 g / 6 oz)", grams: 170 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "pork-tenderloin",
    aliases: ["pork tenderloin", "pork loin", "lean pork"],
    // USDA: Pork, fresh, loin, tenderloin, lean, cooked, roasted
    per100g: m(166, 28.3, 0.0, 4.9, 0.0, 59),
    portions: [
      { key: "small", label: "small (85 g / 3 oz)", grams: 85 },
      { key: "medium", label: "medium (113 g / 4 oz)", grams: 113 },
      { key: "large", label: "large (170 g / 6 oz)", grams: 170 },
    ],
    defaultPortionKey: "medium",
  },

  // ── Grains & Starches ─────────────────────────────────────────────────────
  {
    slug: "white-rice-cooked",
    aliases: ["white rice", "jasmine rice", "basmati rice", "rice", "cooked rice"],
    // USDA: Rice, white, long-grain, regular, enriched, cooked
    per100g: m(130, 2.7, 28.2, 0.3, 0.4, 1),
    portions: [
      { key: "0.5cup", label: "½ cup cooked (79 g)", grams: 79 },
      { key: "1cup", label: "1 cup cooked (158 g)", grams: 158 },
      { key: "1.5cup", label: "1½ cups cooked (237 g)", grams: 237 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "brown-rice-cooked",
    aliases: ["brown rice", "whole grain rice", "cooked brown rice"],
    // USDA: Rice, brown, long-grain, cooked
    per100g: m(123, 2.7, 25.6, 1.0, 1.8, 5),
    portions: [
      { key: "0.5cup", label: "½ cup cooked (98 g)", grams: 98 },
      { key: "1cup", label: "1 cup cooked (195 g)", grams: 195 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "oats-dry",
    aliases: ["oats", "rolled oats", "oatmeal", "old fashioned oats", "quick oats"],
    // USDA: Cereals, oats, regular and quick and instant, unenriched, dry
    per100g: m(389, 16.9, 66.3, 6.9, 10.6, 2),
    portions: [
      { key: "0.25cup", label: "¼ cup dry (20 g)", grams: 20 },
      { key: "0.5cup", label: "½ cup dry (40 g)", grams: 40 },
      { key: "1cup", label: "1 cup dry (80 g)", grams: 80 },
    ],
    defaultPortionKey: "0.5cup",
  },
  {
    slug: "quinoa-cooked",
    aliases: ["quinoa", "cooked quinoa"],
    // USDA: Quinoa, cooked
    per100g: m(120, 4.4, 21.3, 1.9, 2.8, 7),
    portions: [
      { key: "0.5cup", label: "½ cup cooked (93 g)", grams: 93 },
      { key: "1cup", label: "1 cup cooked (185 g)", grams: 185 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "potato",
    aliases: ["potatoes", "baked potato", "russet potato", "white potato"],
    // USDA: Potatoes, flesh and skin, raw
    per100g: m(77, 2.0, 17.5, 0.1, 2.2, 6),
    portions: [
      { key: "small", label: "small (170 g)", grams: 170 },
      { key: "medium", label: "medium (213 g)", grams: 213 },
      { key: "large", label: "large (299 g)", grams: 299 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "sweet-potato",
    aliases: ["sweet potatoes", "yam", "baked sweet potato"],
    // USDA: Sweet potato, raw, unprepared
    per100g: m(86, 1.6, 20.1, 0.1, 3.0, 55),
    portions: [
      { key: "small", label: "small (130 g)", grams: 130 },
      { key: "medium", label: "medium (150 g)", grams: 150 },
      { key: "large", label: "large (180 g)", grams: 180 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "pasta-cooked",
    aliases: [
      "pasta",
      "spaghetti",
      "penne",
      "fettuccine",
      "linguine",
      "noodles",
      "cooked pasta",
    ],
    // USDA: Pasta, cooked, enriched, without added salt
    per100g: m(158, 5.8, 31.0, 0.9, 1.8, 1),
    portions: [
      { key: "0.5cup", label: "½ cup cooked (70 g)", grams: 70 },
      { key: "1cup", label: "1 cup cooked (140 g)", grams: 140 },
      { key: "2cups", label: "2 cups cooked (280 g)", grams: 280 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "bread-white",
    aliases: ["white bread", "bread", "sandwich bread", "toast"],
    // USDA: Bread, white, commercially prepared (includes soft bread crumbs)
    per100g: m(265, 9.0, 49.0, 3.2, 2.7, 491),
    portions: [
      { key: "1slice", label: "1 slice (28 g)", grams: 28 },
      { key: "2slices", label: "2 slices (56 g)", grams: 56 },
    ],
    defaultPortionKey: "1slice",
  },
  {
    slug: "tortilla-flour",
    aliases: ["flour tortilla", "tortilla", "wrap"],
    // USDA: Tortillas, ready-to-bake or -fry, flour
    per100g: m(306, 8.0, 51.0, 7.1, 2.4, 595),
    portions: [
      { key: "small", label: "small 6-inch (30 g)", grams: 30 },
      { key: "medium", label: "medium 8-inch (45 g)", grams: 45 },
      { key: "large", label: "large 10-inch (60 g)", grams: 60 },
    ],
    defaultPortionKey: "medium",
  },
  {
    slug: "rice-cakes",
    aliases: ["rice cake", "plain rice cakes"],
    // USDA: Rice cakes, brown rice, plain, unsalted
    per100g: m(392, 8.2, 81.6, 3.7, 2.0, 7),
    portions: [
      { key: "1cake", label: "1 cake (9 g)", grams: 9 },
      { key: "2cakes", label: "2 cakes (18 g)", grams: 18 },
    ],
    defaultPortionKey: "2cakes",
  },

  // ── Vegetables ────────────────────────────────────────────────────────────
  {
    slug: "broccoli",
    aliases: ["broccoli florets", "steamed broccoli", "roasted broccoli"],
    // USDA: Broccoli, raw
    per100g: m(34, 2.8, 6.6, 0.4, 2.6, 33),
    portions: [
      { key: "0.5cup", label: "½ cup florets (45 g)", grams: 45 },
      { key: "1cup", label: "1 cup florets (91 g)", grams: 91 },
      { key: "2cups", label: "2 cups florets (182 g)", grams: 182 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "spinach",
    aliases: ["baby spinach", "fresh spinach", "spinach leaves"],
    // USDA: Spinach, raw
    per100g: m(23, 2.9, 3.6, 0.4, 2.2, 79),
    portions: [
      { key: "1cup", label: "1 cup raw (30 g)", grams: 30 },
      { key: "2cups", label: "2 cups raw (60 g)", grams: 60 },
      { key: "1bag", label: "1 bag (142 g)", grams: 142 },
    ],
    defaultPortionKey: "2cups",
  },
  {
    slug: "avocado",
    aliases: ["avocados", "hass avocado", "guacamole base"],
    // USDA: Avocados, raw, California
    per100g: m(160, 2.0, 8.5, 14.7, 6.7, 7),
    portions: [
      { key: "small", label: "small (102 g)", grams: 102 },
      { key: "medium", label: "medium (136 g)", grams: 136 },
      { key: "large", label: "large (173 g)", grams: 173 },
      { key: "0.5", label: "½ medium (68 g)", grams: 68 },
    ],
    defaultPortionKey: "medium",
  },

  // ── Legumes & Plant Proteins ──────────────────────────────────────────────
  {
    slug: "tofu-firm",
    aliases: ["tofu", "firm tofu", "extra firm tofu"],
    // USDA: Tofu, firm, prepared with calcium sulfate and magnesium chloride (nigari)
    per100g: m(76, 8.2, 2.0, 4.8, 0.3, 7),
    portions: [
      { key: "0.5block", label: "½ block (122 g)", grams: 122 },
      { key: "1block", label: "1 block (245 g)", grams: 245 },
      { key: "3oz", label: "3 oz (85 g)", grams: 85 },
    ],
    defaultPortionKey: "0.5block",
  },
  {
    slug: "lentils-cooked",
    aliases: ["lentils", "red lentils", "green lentils", "brown lentils", "cooked lentils"],
    // USDA: Lentils, mature seeds, cooked, boiled, without salt
    per100g: m(116, 9.0, 20.0, 0.4, 7.9, 2),
    portions: [
      { key: "0.5cup", label: "½ cup cooked (99 g)", grams: 99 },
      { key: "1cup", label: "1 cup cooked (198 g)", grams: 198 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "edamame-cooked",
    aliases: ["edamame", "soybeans", "shelled edamame"],
    // USDA: Edamame, frozen, prepared
    per100g: m(122, 10.9, 8.9, 5.2, 5.2, 6),
    portions: [
      { key: "0.5cup", label: "½ cup shelled (75 g)", grams: 75 },
      { key: "1cup", label: "1 cup shelled (155 g)", grams: 155 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "black-beans-canned",
    aliases: ["black beans", "canned black beans"],
    // USDA: Beans, black, mature seeds, canned, drained
    per100g: m(91, 5.9, 16.6, 0.4, 7.3, 400),
    portions: [
      { key: "0.5cup", label: "½ cup drained (88 g)", grams: 88 },
      { key: "1cup", label: "1 cup drained (175 g)", grams: 175 },
    ],
    defaultPortionKey: "0.5cup",
  },
  {
    slug: "chickpeas-canned",
    aliases: [
      "chickpeas",
      "garbanzo beans",
      "canned chickpeas",
      "garbanzos",
    ],
    // USDA: Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained
    per100g: m(119, 7.5, 22.0, 2.0, 6.2, 395),
    portions: [
      { key: "0.5cup", label: "½ cup drained (82 g)", grams: 82 },
      { key: "1cup", label: "1 cup drained (164 g)", grams: 164 },
    ],
    defaultPortionKey: "0.5cup",
  },
  {
    slug: "hummus",
    aliases: ["hummus dip", "store-bought hummus"],
    // USDA: Hummus, commercial
    per100g: m(177, 7.9, 14.3, 10.4, 6.2, 323),
    portions: [
      { key: "2tbsp", label: "2 tbsp (30 g)", grams: 30 },
      { key: "0.25cup", label: "¼ cup (60 g)", grams: 60 },
      { key: "0.5cup", label: "½ cup (125 g)", grams: 125 },
    ],
    defaultPortionKey: "2tbsp",
  },

  // ── Nuts, Seeds & Fats ────────────────────────────────────────────────────
  {
    slug: "almonds",
    aliases: ["almond", "raw almonds", "roasted almonds", "sliced almonds"],
    // USDA: Nuts, almonds
    per100g: m(579, 21.2, 21.6, 49.9, 12.5, 1),
    portions: [
      { key: "1oz", label: "1 oz / ~23 almonds (28 g)", grams: 28 },
      { key: "0.25cup", label: "¼ cup (35 g)", grams: 35 },
      { key: "0.5cup", label: "½ cup (70 g)", grams: 70 },
    ],
    defaultPortionKey: "1oz",
  },
  {
    slug: "walnuts",
    aliases: ["walnut", "raw walnuts", "walnut halves"],
    // USDA: Nuts, walnuts, English
    per100g: m(654, 15.2, 13.7, 65.2, 6.7, 2),
    portions: [
      { key: "1oz", label: "1 oz (28 g)", grams: 28 },
      { key: "0.25cup", label: "¼ cup (29 g)", grams: 29 },
      { key: "0.5cup", label: "½ cup (58 g)", grams: 58 },
    ],
    defaultPortionKey: "1oz",
  },
  {
    slug: "peanut-butter",
    aliases: [
      "peanut butter",
      "pb",
      "natural peanut butter",
      "smooth peanut butter",
      "chunky peanut butter",
    ],
    // USDA: Peanut butter, smooth style, with salt
    per100g: m(588, 25.0, 20.0, 50.0, 6.0, 430),
    portions: [
      { key: "1tbsp", label: "1 tbsp (16 g)", grams: 16 },
      { key: "2tbsp", label: "2 tbsp (32 g)", grams: 32 },
      { key: "0.25cup", label: "¼ cup (65 g)", grams: 65 },
    ],
    defaultPortionKey: "2tbsp",
  },
  {
    slug: "flaxseed",
    aliases: ["flax seeds", "flaxseeds", "ground flaxseed", "flax meal"],
    // USDA: Seeds, flaxseed
    per100g: m(534, 18.3, 28.9, 42.2, 27.3, 30),
    portions: [
      { key: "1tbsp", label: "1 tbsp (7 g)", grams: 7 },
      { key: "2tbsp", label: "2 tbsp (14 g)", grams: 14 },
      { key: "0.25cup", label: "¼ cup (37 g)", grams: 37 },
    ],
    defaultPortionKey: "1tbsp",
  },
  {
    slug: "chia-seeds",
    aliases: ["chia", "chia seed"],
    // USDA: Seeds, chia seeds, dried
    per100g: m(486, 16.5, 42.1, 30.7, 34.4, 16),
    portions: [
      { key: "1tbsp", label: "1 tbsp (10 g)", grams: 10 },
      { key: "2tbsp", label: "2 tbsp (20 g)", grams: 20 },
      { key: "0.25cup", label: "¼ cup (45 g)", grams: 45 },
    ],
    defaultPortionKey: "1tbsp",
  },
  {
    slug: "olive-oil",
    aliases: ["olive oil", "extra virgin olive oil", "evoo"],
    // USDA: Oil, olive, salad or cooking
    per100g: m(884, 0.0, 0.0, 100.0, 0.0, 2),
    portions: [
      { key: "1tsp", label: "1 tsp (5 g)", grams: 5 },
      { key: "1tbsp", label: "1 tbsp (14 g)", grams: 14 },
      { key: "2tbsp", label: "2 tbsp (28 g)", grams: 28 },
    ],
    defaultPortionKey: "1tbsp",
  },
  {
    slug: "butter",
    aliases: ["salted butter", "unsalted butter", "butter pat"],
    // USDA: Butter, with salt
    per100g: m(717, 0.9, 0.1, 81.1, 0.0, 643),
    portions: [
      { key: "1tsp", label: "1 tsp (5 g)", grams: 5 },
      { key: "1tbsp", label: "1 tbsp (14 g)", grams: 14 },
      { key: "1pat", label: "1 pat (5 g)", grams: 5 },
    ],
    defaultPortionKey: "1tbsp",
  },
  {
    slug: "honey",
    aliases: ["raw honey", "honey"],
    // USDA: Honey
    per100g: m(304, 0.3, 82.4, 0.0, 0.2, 4),
    portions: [
      { key: "1tsp", label: "1 tsp (7 g)", grams: 7 },
      { key: "1tbsp", label: "1 tbsp (21 g)", grams: 21 },
      { key: "0.25cup", label: "¼ cup (84 g)", grams: 84 },
    ],
    defaultPortionKey: "1tbsp",
  },

  // ── Dairy ─────────────────────────────────────────────────────────────────
  {
    slug: "greek-yogurt-nonfat",
    aliases: [
      "greek yogurt",
      "nonfat greek yogurt",
      "plain greek yogurt",
      "0% greek yogurt",
    ],
    // USDA: Yogurt, Greek, plain, nonfat
    per100g: m(59, 10.2, 3.6, 0.4, 0.0, 36),
    portions: [
      { key: "0.5cup", label: "½ cup (113 g)", grams: 113 },
      { key: "1cup", label: "1 cup (227 g)", grams: 227 },
      { key: "small", label: "small container (150 g)", grams: 150 },
      { key: "large", label: "large container (227 g)", grams: 227 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "whole-milk",
    aliases: ["milk", "full fat milk", "2% milk", "skim milk"],
    // USDA: Milk, whole, 3.25% milkfat, without added vitamin A and vitamin D
    per100g: m(61, 3.2, 4.8, 3.3, 0.0, 43),
    portions: [
      { key: "0.5cup", label: "½ cup (122 g)", grams: 122 },
      { key: "1cup", label: "1 cup / 8 fl oz (244 g)", grams: 244 },
    ],
    defaultPortionKey: "1cup",
  },
  {
    slug: "cheddar",
    aliases: ["cheddar cheese", "sharp cheddar", "mild cheddar", "cheese"],
    // USDA: Cheese, cheddar
    per100g: m(403, 24.9, 1.3, 33.1, 0.0, 621),
    portions: [
      { key: "1oz", label: "1 oz (28 g)", grams: 28 },
      { key: "1slice", label: "1 slice (28 g)", grams: 28 },
      { key: "0.25cup", label: "¼ cup shredded (28 g)", grams: 28 },
    ],
    defaultPortionKey: "1oz",
  },
  {
    slug: "cottage-cheese",
    aliases: ["cottage cheese 2%", "lowfat cottage cheese"],
    // USDA: Cheese, cottage, lowfat, 2% milkfat
    per100g: m(90, 12.4, 3.4, 2.7, 0.0, 364),
    portions: [
      { key: "0.5cup", label: "½ cup (113 g)", grams: 113 },
      { key: "1cup", label: "1 cup (226 g)", grams: 226 },
    ],
    defaultPortionKey: "0.5cup",
  },
  {
    slug: "mozzarella",
    aliases: ["mozzarella cheese", "part skim mozzarella", "fresh mozzarella"],
    // USDA: Cheese, mozzarella, part skim milk
    per100g: m(254, 24.3, 2.8, 15.9, 0.0, 466),
    portions: [
      { key: "1oz", label: "1 oz (28 g)", grams: 28 },
      { key: "0.25cup", label: "¼ cup shredded (28 g)", grams: 28 },
    ],
    defaultPortionKey: "1oz",
  },
  {
    slug: "cream-cheese",
    aliases: ["cream cheese spread", "neufchatel"],
    // USDA: Cheese, cream
    per100g: m(342, 6.2, 4.1, 34.9, 0.0, 321),
    portions: [
      { key: "1tbsp", label: "1 tbsp (14 g)", grams: 14 },
      { key: "2tbsp", label: "2 tbsp (28 g)", grams: 28 },
      { key: "1oz", label: "1 oz (28 g)", grams: 28 },
    ],
    defaultPortionKey: "2tbsp",
  },
];

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

/**
 * Find a builtin food by query string.
 * Matches against slug and all aliases (case-insensitive exact match).
 */
export function findBuiltin(query: string): BuiltinFood | null {
  const q = query.trim().toLowerCase();
  for (const food of BUILTINS) {
    if (food.slug === q) return food;
    if (food.aliases.some((a) => a.toLowerCase() === q)) return food;
  }
  return null;
}

/**
 * Resolve how many grams a portion key or sizeWord maps to for a given builtin.
 * Falls back to the defaultPortionKey, then 100g.
 */
export function resolveBuiltinGrams(
  food: BuiltinFood,
  sizeWord: "small" | "medium" | "large" | null,
  explicitGrams: number | null,
): { grams: number; label: string } {
  if (explicitGrams != null) {
    return { grams: explicitGrams, label: `${explicitGrams} g` };
  }
  if (sizeWord) {
    const p = food.portions.find((x) => x.key === sizeWord);
    if (p) return { grams: p.grams, label: p.label };
  }
  const defaultPortion = food.portions.find((x) => x.key === food.defaultPortionKey);
  if (defaultPortion) return { grams: defaultPortion.grams, label: defaultPortion.label };
  return { grams: 100, label: "100 g" };
}
