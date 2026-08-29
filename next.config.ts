import type { NextConfig } from 'next'
// Load-bearing: validates env at build time. Next loads `.env*` before evaluating
// this file, so a missing variable fails the build here rather than at request time.
import './src/lib/env'

const nextConfig: NextConfig = {
  typedRoutes: true,
}

export default nextConfig
