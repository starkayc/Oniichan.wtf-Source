const LEGACY_PATHS = {
  "/help": "/help/",
  "/help/index": "/help/index.html",
  "/help/songs": "/help/songs.html",
  "/help/skins": "/help/skins.html",
};

/** The real file for a requested pathname, or null when nothing here matches. */
export const resolveLegacyPath = (pathname) => {
  // A trailing slash means a real directory, which Pages already serves.
  if (pathname.endsWith("/")) return null;
  return LEGACY_PATHS[pathname.toLowerCase()] ?? null;
};
