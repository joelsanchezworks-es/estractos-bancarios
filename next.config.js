/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pdf-parse (and its bundled pdf.js) must stay external so Next doesn't
    // try to bundle its optional test-file access into the serverless output.
    serverComponentsExternalPackages: ['pdf-parse'],
  },
};

module.exports = nextConfig;
