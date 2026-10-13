import path from "node:path"
import type { NextConfig } from "next"

import "./env"

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname, "..") },
  transpilePackages: ["@edu/chat-contract", "@edu/ui"],
}

export default nextConfig
