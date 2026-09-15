import { createContext, useContext, useEffect, useRef, useState } from 'react';

export const DashboardMotionContext = createContext(true);

/** Interruptible numeric transitions; screen readers always receive the final value. */
export function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  const motion = useContext(DashboardMotionContext);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const settle = () => { cancelAnimationFrame(frame); current.current = value; setShown(value); };
    const onPreference = () => { if (preference.matches) settle(); };
    preference.addEventListener('change', onPreference);
    if (!motion || preference.matches || current.current === value) settle();
    else {
      const start = performance.now();
      const initial = current.current;
      const tick = (time: number) => {
        const progress = Math.min(1, (time - start) / 650);
        current.current = initial + (value - initial) * (1 - (1 - progress) ** 3);
        setShown(current.current);
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    return () => { cancelAnimationFrame(frame); preference.removeEventListener('change', onPreference); };
  }, [value, motion]);
  const format = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span aria-label={format(value)}><span aria-hidden="true">{format(shown)}</span></span>;
}
