// Looseleaf, MIT. See ui/looseleaf/LICENSE.
import { defineRecipe } from "@/ui/looseleaf/lib/ink/recipes";
import { drawSelectFrame } from "@/ui/looseleaf/lib/ink/recipes/select-frame-ink";

export interface SelectParams {
  disabled?: boolean;
  invalid?: boolean;
}

export const selectRecipe = defineRecipe<SelectParams>({
  id: "select",
  kind: "field",
  layers: ["rest", "hover", "focus", "open", "invalid", "disabled"],
  lazy: ["focus", "hover"],
  pad: 12,
  draw(ink, box, params, ctx) {
    drawSelectFrame(ink, box, { ...params, openable: true }, ctx);
  },
});
