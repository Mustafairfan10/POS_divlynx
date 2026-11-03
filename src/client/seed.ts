"use client";
import { db } from "./db";
import { defaultSettings, hashPin, save } from "./repo";
import type { Category, DiningTable, MenuItem, ModifierGroup, Staff } from "@/lib/types";

// Deterministic ids: if two devices seed a brand-new store at the same time,
// the records collapse into one on the server instead of duplicating the menu.
// Seed rows are stamped "very old" so any real edit made elsewhere always wins last-writer-wins.
const t = () => 1;
const seedOpts = { keepTimestamp: true };

export const DEFAULT_PINS = { admin: "1234", manager: "2222", cashier: "1111", kitchen: "3333" };

export async function seedStore(businessName: string): Promise<void> {
  const now = t();
  const settings = { ...defaultSettings(), businessName: businessName || "My Cafe", createdAt: now };
  await save("settings", settings, seedOpts);

  const staff: Array<Omit<Staff, "pinHash"> & { pin: string }> = [
    { id: "seed-staff-admin", name: "Admin", role: "admin", pin: DEFAULT_PINS.admin, active: true, createdAt: now, updatedAt: now },
    { id: "seed-staff-manager", name: "Maya (Manager)", role: "manager", pin: DEFAULT_PINS.manager, active: true, createdAt: now, updatedAt: now },
    { id: "seed-staff-cashier", name: "Sam (Cashier)", role: "cashier", pin: DEFAULT_PINS.cashier, active: true, createdAt: now, updatedAt: now },
    { id: "seed-staff-kitchen", name: "Kitchen", role: "kitchen", pin: DEFAULT_PINS.kitchen, active: true, createdAt: now, updatedAt: now },
  ];
  for (const { pin, ...s } of staff) {
    await save("staff", { ...s, pinHash: await hashPin(s.id, pin) }, seedOpts);
  }

  const cats: Category[] = [
    ["coffee", "Coffee", "#92400e"],
    ["tea", "Tea", "#15803d"],
    ["cold", "Cold Drinks", "#0369a1"],
    ["breakfast", "Breakfast", "#ca8a04"],
    ["mains", "Mains", "#b91c1c"],
    ["desserts", "Desserts", "#be185d"],
  ].map(([id, name, color], i) => ({ id: `seed-cat-${id}`, name, color, sort: i, createdAt: now, updatedAt: now }));
  for (const c of cats) await save("categories", c, seedOpts);

  const opt = (g: string, name: string, price = 0) => ({ id: `seed-opt-${g}-${name.toLowerCase().replace(/\W+/g, "-")}`, name, price });
  const groups: ModifierGroup[] = [
    { id: "seed-mg-size", name: "Size", min: 1, max: 1, options: [opt("size", "Small"), opt("size", "Medium", 50), opt("size", "Large", 100)] },
    { id: "seed-mg-milk", name: "Milk", min: 0, max: 1, options: [opt("milk", "Whole"), opt("milk", "Skim"), opt("milk", "Oat", 60), opt("milk", "Almond", 60)] },
    { id: "seed-mg-extras", name: "Extras", min: 0, max: 3, options: [opt("extras", "Extra shot", 75), opt("extras", "Vanilla syrup", 50), opt("extras", "Caramel syrup", 50), opt("extras", "Whipped cream", 40)] },
    { id: "seed-mg-sugar", name: "Sweetness", min: 0, max: 1, options: [opt("sugar", "No sugar"), opt("sugar", "Less sugar"), opt("sugar", "Extra sweet")] },
    { id: "seed-mg-doneness", name: "Cooked", min: 1, max: 1, options: [opt("done", "Medium rare"), opt("done", "Medium"), opt("done", "Well done")] },
    { id: "seed-mg-addons", name: "Add-ons", min: 0, max: 4, options: [opt("add", "Cheese", 100), opt("add", "Bacon", 150), opt("add", "Avocado", 150), opt("add", "Fried egg", 100)] },
    { id: "seed-mg-side", name: "Side", min: 1, max: 1, options: [opt("side", "Fries"), opt("side", "Side salad"), opt("side", "Sweet potato fries", 100)] },
    { id: "seed-mg-eggs", name: "Eggs", min: 1, max: 1, options: [opt("eggs", "Scrambled"), opt("eggs", "Fried"), opt("eggs", "Poached")] },
  ].map((g) => ({ ...g, createdAt: now, updatedAt: now }));
  for (const g of groups) await save("modifierGroups", g, seedOpts);

  const item = (id: string, cat: string, name: string, price: number, mods: string[] = [], description = ""): MenuItem => ({
    id: `seed-item-${id}`,
    categoryId: `seed-cat-${cat}`,
    name,
    price,
    description,
    available: true,
    modifierGroupIds: mods.map((m) => `seed-mg-${m}`),
    sort: 0,
    createdAt: now,
    updatedAt: now,
  });
  const items: MenuItem[] = [
    item("espresso", "coffee", "Espresso", 300, ["extras"]),
    item("americano", "coffee", "Americano", 350, ["size", "extras"]),
    item("latte", "coffee", "Caffè Latte", 450, ["size", "milk", "extras"]),
    item("cappuccino", "coffee", "Cappuccino", 450, ["size", "milk", "extras"]),
    item("flatwhite", "coffee", "Flat White", 430, ["milk", "extras"]),
    item("mocha", "coffee", "Mocha", 490, ["size", "milk", "extras"]),
    item("chai", "tea", "Chai Latte", 450, ["size", "milk", "sugar"]),
    item("greentea", "tea", "Green Tea", 300, ["size", "sugar"]),
    item("earlgrey", "tea", "Earl Grey", 300, ["size", "milk", "sugar"]),
    item("matcha", "tea", "Matcha Latte", 520, ["size", "milk", "sugar"]),
    item("icedlatte", "cold", "Iced Latte", 490, ["size", "milk", "extras"]),
    item("coldbrew", "cold", "Cold Brew", 450, ["size", "sugar"]),
    item("lemonade", "cold", "Fresh Lemonade", 400, ["size", "sugar"]),
    item("oj", "cold", "Orange Juice", 450, ["size"]),
    item("water", "cold", "Sparkling Water", 250),
    item("croissant", "breakfast", "Butter Croissant", 375),
    item("avotoast", "breakfast", "Avocado Toast", 950, ["eggs", "addons"], "Sourdough, smashed avocado, chili flakes"),
    item("eggsbene", "breakfast", "Eggs Benedict", 1250, [], "Poached eggs, ham, hollandaise"),
    item("pancakes", "breakfast", "Buttermilk Pancakes", 1050, ["addons"]),
    item("burger", "mains", "Classic Burger", 1450, ["doneness", "addons", "side"]),
    item("chickensand", "mains", "Grilled Chicken Sandwich", 1350, ["addons", "side"]),
    item("caesar", "mains", "Caesar Salad", 1150, ["addons"]),
    item("pasta", "mains", "Pasta Pomodoro", 1300),
    item("cheesecake", "desserts", "NY Cheesecake", 650),
    item("brownie", "desserts", "Chocolate Brownie", 450, ["addons"]),
    item("cookie", "desserts", "Choc Chip Cookie", 275),
  ].map((m, i) => ({ ...m, sort: i }));
  for (const m of items) await save("menuItems", m, seedOpts);

  const tables: DiningTable[] = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `seed-table-m${i + 1}`, name: `T${i + 1}`, seats: i < 4 ? 2 : 4, area: "Main", sort: i })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `seed-table-p${i + 1}`, name: `P${i + 1}`, seats: 4, area: "Patio", sort: 10 + i })),
  ].map((x) => ({ ...x, createdAt: now, updatedAt: now }));
  for (const tb of tables) await save("tables", tb, seedOpts);
}

export async function hasLocalData(): Promise<boolean> {
  return (await db.staff.count()) > 0;
}

export async function usingDefaultAdminPin(): Promise<boolean> {
  const admin = await db.staff.get("seed-staff-admin");
  if (!admin || admin.deleted) return false;
  return admin.pinHash === (await hashPin(admin.id, DEFAULT_PINS.admin));
}
