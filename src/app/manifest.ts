import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cafe POS",
    short_name: "POS",
    description: "Offline-first point of sale for restaurants and cafes",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#15100c",
    theme_color: "#15100c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
