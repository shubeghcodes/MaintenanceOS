import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/pwa/ServiceWorker";

export const metadata: Metadata = {
  title: { default: "MaintenanceOS", template: "%s · MaintenanceOS" },
  description: "Maintenance, assets, PM and compliance for every location.",
  applicationName: "MaintenanceOS",
  appleWebApp: { capable: true, title: "MaintenanceOS", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#2c58c4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
