import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A stray package-lock.json at C:\Users\humres\ (unrelated to this
  // project) made Turbopack guess the wrong workspace root. Pin it
  // explicitly to this project's own directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
