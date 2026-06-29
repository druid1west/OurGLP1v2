export type NutritionFood = {
  id: string;
  name: string;
  servingLabel: string;
  servingOz?: number;
  servingGrams?: number;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
};

export const NUTRITION_FOODS: NutritionFood[] = [
  { id: 'ribeye-3oz', name: 'Ribeye steak', servingLabel: '3 oz / 85 g', servingOz: 3, servingGrams: 85, protein: 22, carbs: 0, fat: 20, calories: 270 },
  { id: 'filet-3oz', name: 'Filet steak', servingLabel: '3 oz / 85 g', servingOz: 3, servingGrams: 85, protein: 24, carbs: 0, fat: 9, calories: 180 },
  { id: 'sirloin-3oz', name: 'Sirloin steak', servingLabel: '3 oz / 85 g', servingOz: 3, servingGrams: 85, protein: 25, carbs: 0, fat: 8, calories: 180 },
  { id: 'lean-beef-100g', name: 'Lean beef mince', servingLabel: '100 g', servingGrams: 100, protein: 26, carbs: 0, fat: 10, calories: 210 },
  { id: 'chicken-breast-100g', name: 'Chicken breast', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 31, carbs: 0, fat: 4, calories: 165 },
  { id: 'turkey-breast-100g', name: 'Turkey breast', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 29, carbs: 0, fat: 1, calories: 135 },
  { id: 'turkey-mince-100g', name: 'Turkey mince', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 27, carbs: 0, fat: 8, calories: 190 },
  { id: 'pork-tenderloin-100g', name: 'Pork tenderloin', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 26, carbs: 0, fat: 4, calories: 145 },
  { id: 'salmon-100g', name: 'Salmon', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 22, carbs: 0, fat: 13, calories: 208 },
  { id: 'tuna-100g', name: 'Tuna', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 29, carbs: 0, fat: 1, calories: 132 },
  { id: 'cod-100g', name: 'Cod', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 18, carbs: 0, fat: 1, calories: 82 },
  { id: 'shrimp-100g', name: 'Prawns / shrimp', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 24, carbs: 0, fat: 0, calories: 99 },
  { id: 'sardines-100g', name: 'Sardines', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 25, carbs: 0, fat: 11, calories: 208 },
  { id: 'mackerel-100g', name: 'Mackerel', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 19, carbs: 0, fat: 14, calories: 205 },
  { id: 'egg-large', name: 'Egg', servingLabel: '1 large / 50 g', servingGrams: 50, protein: 6, carbs: 1, fat: 5, calories: 72 },
  { id: 'egg-whites-100g', name: 'Egg whites', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 11, carbs: 1, fat: 0, calories: 52 },
  { id: 'greek-yogurt-100g', name: 'Greek yogurt', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 10, carbs: 4, fat: 0, calories: 59 },
  { id: 'cottage-cheese-100g', name: 'Cottage cheese', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 11, carbs: 3, fat: 4, calories: 98 },
  { id: 'whey-scoop', name: 'Whey protein', servingLabel: '1 scoop / 30 g', servingGrams: 30, protein: 25, carbs: 2, fat: 2, calories: 120 },
  { id: 'tofu-100g', name: 'Tofu', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 10, carbs: 2, fat: 6, calories: 100 },
  { id: 'tempeh-100g', name: 'Tempeh', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 19, carbs: 9, fat: 11, calories: 193 },
  { id: 'edamame-100g', name: 'Edamame', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 11, carbs: 9, fat: 5, calories: 121 },
  { id: 'lentils-100g', name: 'Lentils', servingLabel: '100 g cooked', servingGrams: 100, protein: 9, carbs: 20, fat: 0, calories: 116 },
  { id: 'chickpeas-100g', name: 'Chickpeas', servingLabel: '100 g cooked', servingGrams: 100, protein: 9, carbs: 27, fat: 3, calories: 164 },
  { id: 'cheddar-30g', name: 'Cheddar cheese', servingLabel: '1 oz / 30 g', servingOz: 1, servingGrams: 30, protein: 7, carbs: 0, fat: 10, calories: 120 },
  { id: 'mozzarella-30g', name: 'Mozzarella', servingLabel: '1 oz / 30 g', servingOz: 1, servingGrams: 30, protein: 7, carbs: 1, fat: 6, calories: 85 },
  { id: 'peanut-butter-2tbsp', name: 'Peanut butter', servingLabel: '2 tbsp / 32 g', servingGrams: 32, protein: 7, carbs: 7, fat: 16, calories: 190 },
  { id: 'protein-bar', name: 'Protein bar', servingLabel: '1 bar / approx. 60 g', servingGrams: 60, protein: 20, carbs: 20, fat: 7, calories: 220 },
  { id: 'jerky-30g', name: 'Beef jerky', servingLabel: '1 oz / 30 g', servingOz: 1, servingGrams: 30, protein: 10, carbs: 3, fat: 1, calories: 70 },
  { id: 'rotisserie-chicken-100g', name: 'Rotisserie chicken', servingLabel: '100 g / 3.5 oz', servingOz: 3.5, servingGrams: 100, protein: 27, carbs: 0, fat: 9, calories: 190 },
];

export function scaleFood(food: NutritionFood, servings: number): NutritionFood {
  const multiplier = Number.isFinite(servings) ? Math.max(0, servings) : 1;
  return {
    ...food,
    servingOz: food.servingOz == null ? undefined : Number((food.servingOz * multiplier).toFixed(1)),
    servingGrams: food.servingGrams == null ? undefined : Math.round(food.servingGrams * multiplier),
    protein: Math.round(food.protein * multiplier),
    carbs: Math.round(food.carbs * multiplier),
    fat: Math.round(food.fat * multiplier),
    calories: Math.round(food.calories * multiplier),
  };
}
