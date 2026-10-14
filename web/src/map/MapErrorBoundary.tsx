import { Component, type ReactNode } from 'react';
import { Banner } from '../components/ui';

/**
 * If anything inside the map throws, show the documented fallback instead of
 * unmounting the console. The feed, tables and timeline do not depend on it.
 */
export class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Map stopped after an error', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="map-failure" role="status">
        <Banner>This device can't draw the map. Feed, tables and timeline still work.</Banner>
      </div>
    );
  }
}
