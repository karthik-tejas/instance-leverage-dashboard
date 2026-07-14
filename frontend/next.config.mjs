/** @type {import('next').NextConfig} */
const nextConfig = {
  // Both must point at the same directory -- otherwise Next.js warns because
  // dev (Turbopack) and build (file tracing for the serverless bundle) would
  // disagree on the project root. Without this, Next.js can auto-detect a
  // different root by walking up looking for a lockfile, which in this
  // monorepo (frontend/ + backend/, no root-level package.json) can resolve
  // above frontend/ and diverge from turbopack.root.
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
};
export default nextConfig;
