// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MaterialChecklist } from "./RunSheetMaterials";
import type { ResolvedRef } from "@/lib/materials/materials";
import type { StockState } from "@/lib/materials/kitStock";

afterEach(cleanup);

const need = (id: string, label: string): ResolvedRef => ({ id, label });
const draw = (needs: ResolvedRef[], stock: Record<string, StockState>) =>
  render(<MaterialChecklist needs={needs} stock={stock} onSetStockState={vi.fn()} />).container;

describe("MaterialChecklist — coverage pill + rows", () => {
  it("lists every material need by label", () => {
    draw([need("felt", "Felt"), need("glue", "Glue")], {});
    expect(screen.getByText("Felt")).toBeTruthy();
    expect(screen.getByText("Glue")).toBeTruthy();
  });

  it("shows no coverage pill when stock is unset (the lens is inert)", () => {
    const c = draw([need("felt", "Felt")], {});
    expect(c.querySelector(".matkit__pill")).toBeNull();
  });

  it("shows a 'Ready' pill when every need is on hand", () => {
    draw([need("felt", "Felt"), need("glue", "Glue")], { felt: "have", glue: "have" });
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("counts the missing items when some are out", () => {
    // felt on hand; glue + tape not → 2 missing
    draw([need("felt", "Felt"), need("glue", "Glue"), need("tape", "Tape")], { felt: "have" });
    expect(screen.getByText("2 missing")).toBeTruthy();
  });
});
