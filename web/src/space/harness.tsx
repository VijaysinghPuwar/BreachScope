// Temporary page for testing SpaceView on its own. Served by the Vite dev server at
// /src/space/harness.html and not part of the production build.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import SpaceView from './SpaceView';

// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const [returns, setReturns] = useState(0);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <SpaceView reducedMotion={reducedMotion} onReturnToEarth={() => setReturns((n) => n + 1)} />
      <output data-testid="returns" style={{ position: 'absolute', left: -9999 }}>
        {returns}
      </output>
    </main>
  );
}

document.body.style.margin = '0';
document.body.style.background = 'var(--bg-base)';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
