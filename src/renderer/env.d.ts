/**
 * Build-time constants injected via the `define` block in
 * `electron.vite.config.ts`. Declared here so TypeScript accepts the
 * bare identifier in the renderer source without sprinkling `declare`
 * in every call site.
 */

/** Current app version — mirrored from `package.json` at bundle time. */
declare const __APP_VERSION__: string
