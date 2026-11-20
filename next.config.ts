import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  distDir: process.env.EIS_NEXT_OUTPUT || ".next",
  serverExternalPackages: ["pg", "playwright", "@aws-sdk/client-s3"],
};

export default config;
