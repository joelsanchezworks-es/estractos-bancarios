/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfjs-dist ships modern ESM; transpile it so Next can bundle it for the
  // browser (client-side PDF text extraction).
  transpilePackages: ['pdfjs-dist'],
  experimental: {
    // pdf-parse (and its bundled pdf.js) must stay external so Next doesn't
    // try to bundle its optional test-file access into the serverless output.
    serverComponentsExternalPackages: ['pdf-parse'],
  },
  webpack: (config) => {
    // pdfjs-dist references the optional Node "canvas" package (only used for
    // server-side rendering, which we don't do). Stub it so webpack doesn't try
    // to resolve it in the browser bundle.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

module.exports = nextConfig;
