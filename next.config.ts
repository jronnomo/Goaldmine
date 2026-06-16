import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/recap/card": ["./src/app/recap/fonts/**"],
    "/recap/story/[slide]": ["./src/app/recap/fonts/**"],
    "/api/mcp": ["./src/app/recap/fonts/**"],
  },
};

export default nextConfig;
