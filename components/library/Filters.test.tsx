// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { Filters } from "./Filters";
import { ALL_CATEGORY_IDS } from "@/lib/content/data";

afterEach(cleanup);

const callbacks = () => ({
  onSort: vi.fn(),
  onAgeUnit: vi.fn(),
  onCats: vi.fn(),
  onPlace: vi.fn(),
  onAge: vi.fn(),
  onTheme: vi.fn(),
  onManageThemes: vi.fn(),
  onStarredOnly: vi.fn(),
  onMinutes: vi.fn(),
  onKitLens: vi.fn(),
  onMaterial: vi.fn(),
  onSetupKit: vi.fn(),
});

const mountRail = (on = callbacks()) => {
  render(
    <Filters
      variant="rail"
      sort="az"
      cats={ALL_CATEGORY_IDS}
      place="All"
      age="All"
      ageUnit="grades"
      theme="All"
      themes={[]}
      starredOnly={false}
      kitLens="all"
      kitUnset
      minutes={[0, 120]}
      minutesBounds={{ min: 0, max: 120 }}
      materialId={null}
      materialLabel={null}
      {...on}
    />
  );
  return on;
};

describe("Filters (rail) — the library filter ledger", () => {
  it("renders its filter controls", () => {
    mountRail();
    expect(screen.getByText("Starred only")).toBeTruthy();
  });

  it("toggling 'Starred only' reports the new value", () => {
    const on = mountRail();
    fireEvent.click(screen.getByLabelText("Show starred activities only"));
    expect(on.onStarredOnly).toHaveBeenCalledWith(true);
  });
});
