/**
 * Every magnet in the system.
 *
 * The import is deliberately explicit rather than a filesystem scan: the bundler
 * can see it, so a magnet that fails to resolve breaks the build instead of
 * 404ing in production. Adding a magnet means adding one line here.
 */
import { sampleGuide } from "./sample-guide";
import type { MagnetConfig } from "./types";
import { veroCostEstimator } from "./vero-cost-estimator/config";

const all: MagnetConfig[] = [sampleGuide, veroCostEstimator];

const bySlug = new Map<string, MagnetConfig>(all.map((magnet) => [magnet.slug, magnet]));

/** Returns the magnet, or undefined if the slug is unknown. */
export function getMagnet(slug: string): MagnetConfig | undefined {
  return bySlug.get(slug);
}

/**
 * Returns the magnet only if it is accepting submissions. The API uses this so
 * an unpublished magnet's page can be previewed while its form stays closed.
 */
export function getPublishedMagnet(slug: string): MagnetConfig | undefined {
  const magnet = bySlug.get(slug);
  return magnet?.published ? magnet : undefined;
}

export function listMagnets(): readonly MagnetConfig[] {
  return all;
}
