/**
 * `vite build` inlines every VITE_* variable into the public bundle, so a dev
 * bearer token must never reach any build, whatever the mode (staging, custom
 * modes and "development" builds are all deployable). Used by vite.config.ts.
 * The error never echoes the value.
 */
export const assertNoDevTokenInBuild = (
  command: string,
  _mode: string,
  env: Record<string, string | undefined>
): void => {
  if (command === "build" && env.VITE_DEV_BEARER_TOKEN) {
    throw new Error(
      "VITE_DEV_BEARER_TOKEN is set: it would be inlined into the bundle of any build, whatever the mode. Unset it (.env.local / shell) before `vite build`."
    );
  }
};
