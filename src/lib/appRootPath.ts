/** Vite's deployment base is also the safe hard-reload destination in Nosu's iframe. */
export function appRootPath(): string {
  return import.meta.env.BASE_URL || "/";
}
