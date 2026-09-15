import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A standalone build puts the server and only its needed dependencies in
  // .next/standalone, which is what goes in the container. DES §8: a web-app
  // deploys as a container, and a smaller image is a smaller attack surface.
  output: "standalone",
  reactStrictMode: true,

  // Chrome and puppeteer must not be bundled: the chromium package ships a
  // binary payload that a bundler cannot meaningfully process, and puppeteer
  // resolves its own files at runtime.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],

  // Report templates are read from disk at render time. Without this the
  // tracer cannot see them — nothing imports them — and they are missing from
  // the deployed function.
  outputFileTracingIncludes: {
    "/api/lead": ["./src/magnets/**/*.html"],
  },

  async rewrites() {
    return {
      // `afterFiles` runs only once the filesystem has had its turn, so a real
      // route and a real static file both still win. This exists so a landing
      // page lives at /m/<slug> rather than /m/<slug>/index.html, while the
      // handed-over bundle stays untouched in public/m/<slug>/ and every
      // relative path inside it keeps resolving.
      afterFiles: [{ source: "/m/:slug", destination: "/m/:slug/index.html" }],
      beforeFiles: [],
      fallback: [],
    };
  },

  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
};

export default nextConfig;
