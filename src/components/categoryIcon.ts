import {
  Beef,
  CakeSlice,
  Coffee,
  Croissant,
  CupSoda,
  EggFried,
  IceCreamCone,
  Leaf,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from "lucide-react";

const RULES: Array<[RegExp, LucideIcon]> = [
  [/coffee|espresso|latte|cafe|café/i, Coffee],
  [/tea|matcha|chai/i, Leaf],
  [/cold|juice|soda|drink|smoothie|shake/i, CupSoda],
  [/breakfast|brunch|egg/i, EggFried],
  [/bake|pastr|bread|croissant/i, Croissant],
  [/dessert|cake|sweet/i, CakeSlice],
  [/ice ?cream|gelato/i, IceCreamCone],
  [/salad|healthy|vegan/i, Salad],
  [/soup/i, Soup],
  [/pizza/i, Pizza],
  [/sandwich|wrap|burger|snack/i, Sandwich],
  [/main|grill|steak|meat/i, Beef],
  [/wine|beer|bar|cocktail/i, Wine],
];

/** Pick a fitting icon for a menu category from its name. */
export function categoryIcon(name: string | undefined): LucideIcon {
  if (!name) return UtensilsCrossed;
  return RULES.find(([re]) => re.test(name))?.[1] ?? UtensilsCrossed;
}
