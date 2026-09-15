import type { TemplateData } from "@/lib/template";

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

/**
 * A generated, per-lead report.
 *
 * The alternative to `asset`: instead of signing a link to one file that every
 * lead receives, the magnet renders a PDF from the lead's own answers and
 * attaches it. The rendered copy is also stored, so sales can see exactly what
 * a given prospect was sent.
 */
export type MagnetReport = {
  /** Attachment filename. `{company}` is replaced with the lead's company. */
  filename: string;
  /**
   * Template path, relative to `src/magnets/`. Must be self-contained —
   * `scripts/extract-template.mjs` and `scripts/embed-fonts.mjs` are what make
   * a handed-over export satisfy that.
   */
  template: string;
  /**
   * Turns the submitted answers into the template's variables. Lives in the
   * magnet's own folder, because it is specific to one report's contract.
   *
   * Returning null means this submission cannot produce a report — the lead is
   * still recorded, and the failure is logged rather than silently emailing a
   * blank document.
   */
  buildData: (fields: Record<string, string>, email: string) => TemplateData | null;
  /** Page size in CSS pixels. Defaults to US Letter at 96dpi. */
  width?: number;
  height?: number;
  /** Keep CSS box-shadows. Off by default; Chrome prints them as grey blocks. */
  keepShadows?: boolean;
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

  /**
   * Static-file delivery: one file in Supabase Storage, sent as a signed link.
   * Exactly one of `asset` or `report` must be set.
   */
  asset?: {
    /** Path inside the Supabase storage bucket, e.g. `seo-guide/guide.pdf`. */
    path: string;
    /** Bucket name. Defaults to `magnets`. */
    bucket?: string;
    /** How long the emailed download link stays valid. Defaults to 24 hours. */
    expiresInSeconds?: number;
  };

  /** Generated-report delivery: a PDF built per lead and attached. */
  report?: MagnetReport;

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

/** Where the rendered copy of a generated report is filed in the bucket. */
export const REPORT_PREFIX = "reports";
