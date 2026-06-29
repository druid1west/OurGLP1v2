export type NutritionTotals = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
};

function numberFrom(data: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = data[key];
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function nutritionFromLogData(data: unknown): NutritionTotals {
  if (!data || typeof data !== 'object') {
    return { protein: 0, carbs: 0, fat: 0, calories: 0 };
  }
  const record = data as Record<string, unknown>;
  const protein = numberFrom(record, ['protein', 'grams', 'protein_grams', 'value']);
  return {
    protein,
    carbs: numberFrom(record, ['carbs', 'carbohydrates', 'carb_grams']),
    fat: numberFrom(record, ['fat', 'fat_grams']),
    calories: numberFrom(record, ['calories', 'kcal', 'calories_kcal']),
  };
}

export function addNutritionTotals(current: NutritionTotals, next: NutritionTotals): NutritionTotals {
  return {
    protein: current.protein + next.protein,
    carbs: current.carbs + next.carbs,
    fat: current.fat + next.fat,
    calories: current.calories + next.calories,
  };
}

export function roundNutritionTotals(totals: NutritionTotals): NutritionTotals {
  return {
    protein: Math.round(totals.protein),
    carbs: Math.round(totals.carbs),
    fat: Math.round(totals.fat),
    calories: Math.round(totals.calories),
  };
}
