/**
 * Architectural boundary rules (Phase 4). Encodes the dependency graph the
 * folder taxonomy implies so the next 50 features can't quietly re-couple the
 * app. Every rule below holds on the current tree (the gate is green today).
 *
 *   npm run lint:boundaries
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Import cycles make modules impossible to reason about in isolation.",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-test",
      severity: "error",
      comment: "Production code must never import a test file.",
      from: { pathNot: "\\.(test|spec)\\.[jt]sx?$" },
      to: { path: "\\.(test|spec)\\.[jt]sx?$" },
    },
    {
      name: "no-server-in-client",
      severity: "error",
      comment:
        "lib/server is server-only (DB, secrets). Components may import its TYPES but never its runtime.",
      from: { path: "^components/" },
      to: { path: "^lib/server/" },
    },
    {
      name: "library-not-calendar",
      severity: "error",
      comment: "The library feature must not reach into calendar internals.",
      from: { path: "^components/library/" },
      to: { path: "^components/calendar/" },
    },
    {
      name: "calendar-not-library",
      severity: "error",
      comment: "The calendar feature must not reach into library internals.",
      from: { path: "^components/calendar/" },
      to: { path: "^components/library/" },
    },
    {
      name: "leaf-features-isolated",
      severity: "error",
      comment:
        "materials, camps, and auth are leaf features — they must not import another feature's components.",
      from: { path: "^components/(materials|camps|auth)/" },
      to: { path: "^components/(activity|library|calendar|print)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "^(app|components|lib|proxy\\.ts)",
    tsConfig: { fileName: "tsconfig.json" },
    // Enforce boundaries on RUNTIME dependencies — type-only imports are erased
    // at build, so they don't create real coupling or import cycles. (This keeps
    // the server rule honest too: the one component that imports a lib/server
    // TYPE is invisible here, which is correct — no server runtime is bundled.)
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
