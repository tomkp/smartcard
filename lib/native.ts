import type { NativeAddon } from './types';

/**
 * Loads the compiled native addon.
 *
 * Uses the `bindings` package rather than a hardcoded path. This:
 * - probes both build/Release and build/Debug relative to the package root,
 *   so debug builds and non-standard layouts resolve correctly, and
 * - keeps bundlers (bun, esbuild, webpack) from trying to statically resolve
 *   the `.node` file at build time, which previously broke them (issue #123).
 *
 * Bundler users may still need to mark the addon as external, but the build
 * no longer fails on a missing relative path.
 */
const addon = require('bindings')('smartcard_napi') as NativeAddon;

export default addon;
