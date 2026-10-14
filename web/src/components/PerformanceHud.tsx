import { useEffect, useState } from 'react';
export function PerformanceHud() {
  const [stats, setStats] = useState({ fps: 0, p95: 0, heap: null as number | null });
  useEffect(() => {
    let frame = 0,
      previous = performance.now(),
      start = previous;
    const samples: number[] = [];
    const tick = (now: number) => {
      samples.push(now - previous);
      previous = now;
      if (now - start >= 1000) {
        const sorted = [...samples].sort((a, b) => a - b);
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory;
        setStats({
          fps: Math.round((samples.length * 1000) / (now - start)),
          p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
          heap: memory ? memory.usedJSHeapSize / 1048576 : null,
        });
        samples.length = 0;
        start = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <aside className="performance-hud mono" aria-label="Performance HUD">
      <dl>
        <div>
          <dt>FPS</dt>
          <dd data-testid="fps">{stats.fps}</dd>
        </div>
        <div>
          <dt>frame p95</dt>
          <dd>{stats.p95.toFixed(1)} ms</dd>
        </div>
        <div>
          <dt>heap</dt>
          <dd>{stats.heap === null ? 'Not available' : `${stats.heap.toFixed(1)} MB`}</dd>
        </div>
        <div>
          <dt>LOD</dt>
          <dd>off</dd>
        </div>
      </dl>
    </aside>
  );
}
