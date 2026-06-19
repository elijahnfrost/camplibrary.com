// Minimal ambient types for pagedjs (the package ships no declarations). Covers
// only the Previewer.preview() surface the Print tab uses; see PagedPreview.tsx.
declare module "pagedjs" {
  export interface PagedFlow {
    total: number;
    pages: unknown[];
    performance?: number;
  }
  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(
      content: Node | string,
      stylesheets?: Array<string | Record<string, string>>,
      renderTo?: HTMLElement
    ): Promise<PagedFlow>;
    on(event: string, callback: (...args: unknown[]) => void): void;
  }
}
