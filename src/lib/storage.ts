import "server-only";
import { DEFAULT_BUCKET, DEFAULT_EXPIRY_SECONDS, type MagnetConfig } from "@/magnets/types";
import { supabase } from "./supabase";

export type SignedAsset = {
  url: string;
  expiresInSeconds: number;
};

/**
 * Mints the time-limited download URL that goes in the email.
 *
 * The bucket is private, so this signature is the only way to reach the file.
 * A link that leaks is a link that expires, which is the whole point of not
 * attaching the asset or parking it in `public/`.
 */
export async function signAssetUrl(magnet: MagnetConfig): Promise<SignedAsset> {
  const bucket = magnet.asset.bucket ?? DEFAULT_BUCKET;
  const expiresInSeconds = magnet.asset.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;

  const { data, error } = await supabase()
    .storage.from(bucket)
    .createSignedUrl(magnet.asset.path, expiresInSeconds, { download: true });

  if (error || !data?.signedUrl) {
    throw new Error(
      `Could not sign "${magnet.asset.path}" in bucket "${bucket}": ${
        error?.message ?? "no URL returned"
      }`,
    );
  }

  return { url: data.signedUrl, expiresInSeconds };
}
