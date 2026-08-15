import { useEffect, useRef, useState } from "react";

export interface UseCountUpOptions {
  /** Duration of the count-up animation in milliseconds (default: 750) */
  duration?: number;
  /** Custom formatter function to format the intermediate and final numbers */
  formatter?: (value: number) => string;
  /** Whether to animate from 0 on initial mount (default: true) */
  startFromZeroOnMount?: boolean;
}

/**
 * Custom hook for smooth count-up / roll-up numeric animations.
 *
 * - Smoothly animates from 0 to target value on initial mount.
 * - Smoothly transitions from previous value to new value when data updates (e.g. after sync).
 * - Uses requestAnimationFrame with ease-out cubic curve.
 * - Automatically respects `prefers-reduced-motion`.
 */
export function useCountUp(
  targetValue: number,
  options: UseCountUpOptions = {}
): string {
  const {
    duration = 750,
    formatter,
    startFromZeroOnMount = true
  } = options;

  const safeTarget = Number.isFinite(targetValue) ? targetValue : 0;
  const isInitialMountRef = useRef(true);
  const currentValueRef = useRef(startFromZeroOnMount ? 0 : safeTarget);
  const [displayValue, setDisplayValue] = useState<number>(currentValueRef.current);
  const animFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Check for user preference for reduced motion
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (prefersReducedMotion || duration <= 0) {
      currentValueRef.current = safeTarget;
      setDisplayValue(safeTarget);
      isInitialMountRef.current = false;
      return;
    }

    const startValue = currentValueRef.current;
    const endValue = safeTarget;

    // If already at target value and not initial mount
    if (startValue === endValue && !isInitialMountRef.current) {
      return;
    }

    isInitialMountRef.current = false;

    // Ease-out cubic: fast start with gentle, organic deceleration
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

    let startTime: number | null = null;

    const tick = (now: number) => {
      if (startTime === null) {
        startTime = now;
      }
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);

      const nextValue = startValue + (endValue - startValue) * easedProgress;
      currentValueRef.current = nextValue;
      setDisplayValue(nextValue);

      if (progress < 1) {
        animFrameIdRef.current = requestAnimationFrame(tick);
      } else {
        currentValueRef.current = endValue;
        setDisplayValue(endValue);
        animFrameIdRef.current = null;
      }
    };

    if (animFrameIdRef.current !== null) {
      cancelAnimationFrame(animFrameIdRef.current);
    }

    animFrameIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [safeTarget, duration]);

  return formatter ? formatter(displayValue) : Math.round(displayValue).toString();
}
