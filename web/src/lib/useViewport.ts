import { useSyncExternalStore } from 'react';
const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const snapshot = () => `${window.innerWidth},${window.innerHeight}`;
export function useViewport() {
  const size = useSyncExternalStore(subscribe, snapshot);
  const [width, height] = size.split(',').map(Number) as [number, number];
  return {
    width,
    height,
    mobile: width < 768,
    tablet: width >= 768 && width < 1280,
    portrait: width >= 768 && width < 1024 && height > width,
  };
}
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribeMotion = (onChange: () => void) => {
  motion.addEventListener('change', onChange);
  return () => motion.removeEventListener('change', onChange);
};
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, () => motion.matches);
}
