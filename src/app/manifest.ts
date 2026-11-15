import type { MetadataRoute } from "next";

/** Makes the app installable ("Add to Home Screen") on phones and desktops. */
export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.NEXT_PUBLIC_COMPANY_NAME ? `MaintenanceOS · ${process.env.NEXT_PUBLIC_COMPANY_NAME}` : "MaintenanceOS";
  return {
    id: "/",
    name,
    short_name: "MaintenanceOS",
    description: "Work orders, PM, compliance and assets for every location.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#2c58c4",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My day", url: "/my-day", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "New work order", url: "/work-orders/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Work orders", url: "/work-orders", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
