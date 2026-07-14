/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deliberately NOT also setting outputFileTracingRoot here: on Vercel's
  // Services build (root: "frontend/"), the build already runs with this
  // directory as its effective root, so explicitly setting
  // outputFileTracingRoot to the same path causes Next's file tracer to
  // double the path (e.g. ".../frontend/frontend/.next/...") and fails the
  // build with an ENOENT on .next/package.json. The mismatched-root warning
  // this produces locally is harmless; this bug is not.
  turbopack: { root: import.meta.dirname },
};
export default nextConfig;
