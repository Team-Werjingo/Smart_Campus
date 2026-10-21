import { createFileRoute } from "@tanstack/react-router";
import { AppNav } from "@/components/AppNav";
import { ReportForm } from "@/components/ReportForm";

export const Route = createFileRoute("/_authenticated/report/lost")({
  head: () => ({
    meta: [
      { title: "Report a lost item — Smart Campus Lost & Found" },
      { name: "description", content: "Describe what you lost and get matched with found items on campus." },
      { property: "og:title", content: "Report a lost item" },
      { property: "og:description", content: "Describe what you lost and get matched automatically." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <div className="min-h-screen">
      <AppNav />
      <ReportForm kind="lost" />
    </div>
  ),
});
