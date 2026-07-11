"use client";

import { Component, type ReactNode } from "react";

// Wraps each heavy tab's content (Library / Calendar / Print) so a render
// crash in ONE surface degrades to an inline card instead of white-screening
// the whole app shell (GAP-1) — the sidebar, tab bar, and profile control stay
// usable, and Try again re-mounts just that tab. A plain class component: React
// error boundaries have no hook equivalent, and this one is intentionally
// minimal (no telemetry hookup here — see app/error.tsx for that note).
//
// No reset-on-prop-change machinery needed: each caller in CampApp renders
// this conditionally on `tab` (`{tab === "library" && <TabBoundary>...}`), so
// switching away unmounts this instance entirely and switching back mounts a
// fresh one — a stale crash can never linger behind the tab bar's own nav.
type Props = { children: ReactNode };
type State = { hasError: boolean };

export class TabBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app__scroll">
          <div className="admin-empty">
            <p>This view hit an error.</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => this.setState({ hasError: false })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
