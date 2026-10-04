/** @type {import('next').NextConfig} */
const {apiTarget, assertApiContract} = require('./scripts/api-contract.cjs');
const {PHASE_PRODUCTION_SERVER} = require('next/constants');
const config = {
  env: {NEXT_PUBLIC_API_BASE_URL: apiTarget(process.env.NEXT_PUBLIC_API_BASE_URL)},
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: [],
  async rewrites() {
    const internal = process.env.INTERNAL_API_BASE_URL;
    return internal ? [{source:'/api/:path*',destination:`${internal}/:path*`}] : [];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    ]}];
  },
};
module.exports = phase => {
  if (phase === PHASE_PRODUCTION_SERVER) assertApiContract(__dirname, config.distDir, process.env.NEXT_PUBLIC_API_BASE_URL);
  return config;
};
