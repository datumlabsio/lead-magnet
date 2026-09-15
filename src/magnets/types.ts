/**
 * The shape of a lead magnet.
 *
 * One of these per magnet, in `src/magnets/<slug>.ts`. It is the only file a
 * coding agent has to write when a new landing page arrives — the landing page
 * itself is dropped into `public/m/<slug>/` verbatim and is never edited beyond
 * adding the one `lm.js` script tag.
 */

/** A form field beyond the email address, which every magnet collects. */
export type MagnetField = {
  /** The `name` attribute on the input in the handed-over HTML. */
  name: string;
  /** Used in validation errors and in the internal notification email. */
  label: string;
  required?: boolean;
  /**
   * HubSpot contact property to write this into, e.g. `firstname`, `company`.
   * Omit to keep the answer in Supabase only — useful for questions that are
   * interesting to us but that nobody wants as a CRM column.
   */
  hubspotProperty?: string;
  /** Rejected above this length before anything is stored. */
  maxLength?: number;
};

export type MagnetConfig = {
  /** URL segment. The page lives at `/m/<slug>`. Must match the filename. */
  slug: string;
  /** Internal name, for dashboards and the team notification. Not public. */
  name: string;
  /**
   * A magnet only accepts submissions when this is true. New magnets should
   * land as `false`, get checked on a preview deploy, then flip.
   */
  published: boolean;

  asset: {
    /** Path inside the Supabase storage bucket, e.g. `seo-guide/guide.pdf`. */
    path: string;
    /** Bucket name. Defaults to `magnets`. */
    bucket?: string;
    /** How long the emailed download link stays valid. Defaults to 24 hours. */
    expiresInSeconds?: number;
  };

  email: {
    subject: string;
    heading: string;
    /** Paragraphs of plain text. Rendered as `<p>`, escaped — no HTML here. */
    body: string[];
    buttonLabel?: string;
    /** Overrides `RESEND_FROM` for this magnet. */
    from?: string;
    replyTo?: string;
  };

  /** Fields besides email. Order is the order they appear in notifications. */
  fields?: MagnetField[];

  hubspot?: {
    /** e.g. `subscriber`, `lead`. Left alone if omitted. */
    lifecycleStage?: string;
    /** Written to a custom property so you can segment by magnet in HubSpot. */
    source?: string;
    /** Any other contact properties to set, as literal values. */
    properties?: Record<string, string>;
  };

  /** Where to send the browser after a successful submit. */
  thankYouUrl?: string;
  /** Shown in place of the form when there is no `thankYouUrl`. */
  successMessage?: string;
};

export const DEFAULT_BUCKET = "magnets";
export const DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24;
