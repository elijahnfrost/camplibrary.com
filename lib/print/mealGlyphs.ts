// Camp Library — print-side meal labels (approved plan §H, "Meals on paper").
//
// Print can't import from components/calendar/* (client components), so this
// module re-exports the ONE shared MealKind label map from lib/meals under the
// name the print renderers consume. Wording is owned by lib/meals — never fork
// it here (that drift is exactly what meals-4 cleaned up).

export { MEAL_KIND_LABELS as MEAL_KIND_LABEL } from "@/lib/meals";
