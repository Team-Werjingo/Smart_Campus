import { createFileRoute } from "@tanstack/react-router";
import { AppNav } from "@/components/AppNav";
import { ReportForm } from "@/components/ReportForm";

export const Route = createFileRoute("/_authenticated/report/found")({
  head: () => ({
    meta: [
      { title: "Report a found item — Smart Campus Lost & Found" },
      { name: "description", content: "Photograph an item you found and help return it to its owner." },
      { property: "og:title", content: "Report a found item" },
      { property: "og:description", content: "Snap a photo and we'll find the owner." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <div className="min-h-screen">
      <AppNav />
      <ReportForm kind="found" />
    </div>
  ),
});
