import { useEffect, useRef } from "react";

export interface DeferredTask {
  /** Unique identifier for the deferred task */
  id: string;
  /** Human-readable task name for debugging/logging */
  name?: string;
  /** The async or sync function to execute */
  run: () => Promise<void> | void;
  /** Specific delay in milliseconds before this task runs (defaults to options.defaultDelayMs) */
  delayMs?: number;
  /** Disable this task conditionally */
  disabled?: boolean;
}

export interface DeferredTasksOptions {
  /** Default delay in milliseconds before executing deferred tasks (default: 1500ms) */
  defaultDelayMs?: number;
  /** Timeout for requestIdleCallback in milliseconds (default: 2000ms) */
  idleTimeoutMs?: number;
  /** Whether all tasks in this hook are disabled */
  disabled?: boolean;
}

type IdleCallbackHandle = number;

function scheduleIdleWork(callback: () => void, timeoutMs: number): () => void {
  const win = typeof window !== "undefined" ? window : undefined;
  if (win && "requestIdleCallback" in win) {
    const handle: IdleCallbackHandle = (win as Window & {
      requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => IdleCallbackHandle;
      cancelIdleCallback: (handle: IdleCallbackHandle) => void;
    }).requestIdleCallback(callback, { timeout: timeoutMs });

    return () => {
      (win as Window & {
        cancelIdleCallback: (handle: IdleCallbackHandle) => void;
      }).cancelIdleCallback(handle);
    };
  }

  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

/**
 * Hook to execute non-critical tasks in the background after the initial render settles
 * and the main thread is idle, ensuring fast and uninterrupted initial page rendering.
 *
 * Future delayed detection/background tasks can be added to this hook's task list.
 */
export function useDeferredTasks(
  tasks: DeferredTask[],
  options: DeferredTasksOptions = {}
): void {
  const { defaultDelayMs = 1500, idleTimeoutMs = 2000, disabled = false } = options;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    if (disabled) {
      return;
    }

    const cancelers: Array<() => void> = [];
    const activeTasks = tasksRef.current.filter((task) => !task.disabled);

    for (const task of activeTasks) {
      const delay = task.delayMs ?? defaultDelayMs;

      const timer = window.setTimeout(() => {
        const cancelIdle = scheduleIdleWork(async () => {
          try {
            await task.run();
          } catch (error) {
            console.warn(`[DeferredTask] Task "${task.name || task.id}" failed:`, error);
          }
        }, idleTimeoutMs);

        cancelers.push(cancelIdle);
      }, delay);

      cancelers.push(() => window.clearTimeout(timer));
    }

    return () => {
      cancelers.forEach((cancel) => cancel());
    };
  }, [disabled, defaultDelayMs, idleTimeoutMs]);
}

/**
 * Convenience hook for running a single deferred effect callback after idle/delay.
 */
export function useDeferredEffect(
  effect: () => Promise<void> | void,
  deps: React.DependencyList = [],
  options: { delayMs?: number; idleTimeoutMs?: number; disabled?: boolean } = {}
): void {
  const { delayMs = 1500, idleTimeoutMs = 2000, disabled = false } = options;
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    if (disabled) {
      return;
    }

    let cancelIdle: (() => void) | null = null;

    const timer = window.setTimeout(() => {
      cancelIdle = scheduleIdleWork(async () => {
        try {
          await effectRef.current();
        } catch (error) {
          console.warn("[DeferredEffect] Execution failed:", error);
        }
      }, idleTimeoutMs);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      if (cancelIdle) {
        cancelIdle();
      }
    };
  }, [disabled, delayMs, idleTimeoutMs, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}
