/** The dev bearer token is only honored by the Vite dev server (import.meta.env.DEV). */
export const resolveDevBearerToken = (
  isDev: boolean,
  token: string | undefined
): string => (isDev ? (token ?? "") : "");
