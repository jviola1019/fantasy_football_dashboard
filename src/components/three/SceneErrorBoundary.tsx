"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Accessible label echoed into the fallback. */
  label: string;
}

interface State {
  failed: boolean;
}

/**
 * Isolates a single WebGL scene. If a scene throws — a shader fails to compile,
 * a WebGL context can't be created, the GPU is out of memory — this boundary
 * catches it and renders a static fallback so the *rest* of the dashboard
 * stays alive. Without this, one failed `<Canvas>` crashes the whole page.
 *
 * Must be a class component: React error boundaries have no hook equivalent.
 */
export class SceneErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced to the console for debugging; never rethrown.
    console.warn(`[RAE] WebGL scene "${this.props.label}" failed to render:`, error.message, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="scene-fallback" role="img" aria-label={`${this.props.label} (visualization unavailable)`}>
          <span className="scene-fallback-mark" aria-hidden>◦ ◦ ◦</span>
          <span className="scene-fallback-text">Visualization unavailable on this device</span>
        </div>
      );
    }
    return this.props.children;
  }
}
