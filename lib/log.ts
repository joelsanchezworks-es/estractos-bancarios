// Lightweight structured step logger for server routes and the pipeline.
// Each timer prints elapsed milliseconds so we can see exactly which step is
// slow (or where a request dies) in the Vercel function logs.

export interface StepTimer {
  log: (step: string, extra?: Record<string, unknown>) => void;
  error: (step: string, err: unknown) => void;
  elapsed: () => number;
}

export function createTimer(scope: string): StepTimer {
  const t0 = Date.now();
  return {
    log(step, extra) {
      console.log(`[${scope}] ${step}`, JSON.stringify({ ms: Date.now() - t0, ...(extra ?? {}) }));
    },
    error(step, err) {
      console.error(
        `[${scope}] ${step} FAILED`,
        JSON.stringify({
          ms: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        }),
        err instanceof Error ? err.stack : '',
      );
    },
    elapsed() {
      return Date.now() - t0;
    },
  };
}
