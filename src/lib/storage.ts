import "server-only";
import {
  DEFAULT_BUCKET,
  DEFAULT_EXPIRY_SECONDS,
  type MagnetConfig,
  REPORT_PREFIX,
} from "@/magnets/types";
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
  const asset = magnet.asset;
  if (!asset) {
    throw new Error(`Magnet "${magnet.slug}" has no static asset to sign`);
  }

  const bucket = asset.bucket ?? DEFAULT_BUCKET;
  const expiresInSeconds = asset.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;

  const { data, error } = await supabase()
    .storage.from(bucket)
    .createSignedUrl(asset.path, expiresInSeconds, { download: true });

  if (error || !data?.signedUrl) {
    throw new Error(
      `Could not sign "${asset.path}" in bucket "${bucket}": ${
        error?.message ?? "no URL returned"
      }`,
    );
  }

  return { url: data.signedUrl, expiresInSeconds };
}

/**
 * Files the rendered copy of a generated report against the lead.
 *
 * The lead already has the PDF as an attachment, so this is for us: it lets
 * sales see exactly what a prospect was sent, and lets a lost email be
 * re-sent without recomputing anything.
 *
 * Best-effort by design — the caller treats a failure as a warning. A storage
 * problem must not stop a report that has already been rendered from going out.
 */
export async function storeReport(
  magnetSlug: string,
  leadId: string,
  pdf: Buffer,
): Promise<string> {
  const path = `${REPORT_PREFIX}/${magnetSlug}/${leadId}.pdf`;

  const { error } = await supabase()
    .storage.from(DEFAULT_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });

  if (error) {
    throw new Error(`Could not store report at "${path}": ${error.message}`);
  }

  return path;
}
