import React from "react";
import { useCountUp, type UseCountUpOptions } from "../hooks/useCountUp";

export interface AnimatedNumberProps extends UseCountUpOptions {
  value: number;
  className?: string;
}

/**
 * Renders a smoothly animated number that counts up on mount or value updates.
 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  duration = 750,
  formatter,
  startFromZeroOnMount = true,
  className
}) => {
  const animatedText = useCountUp(value, {
    duration,
    formatter,
    startFromZeroOnMount
  });

  return <span className={className}>{animatedText}</span>;
};
