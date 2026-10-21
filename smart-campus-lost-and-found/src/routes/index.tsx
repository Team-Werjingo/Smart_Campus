import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Camera, ScanSearch, ShieldCheck, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Campus Lost & Found — AI matches your stuff" },
      { name: "description", content: "Report lost or found items on campus. AI matches photos and descriptions, then connects owners with finders." },
      { property: "og:title", content: "Smart Campus Lost & Found" },
      { property: "og:description", content: "AI-matched lost and found with built-in messaging." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const steps = [
  { icon: Camera, title: "Snap or describe", text: "Finders photograph the item. Owners describe what they lost." },
  { icon: ScanSearch, title: "AI matches", text: "Photos and descriptions are scored against every report." },
  { icon: ShieldCheck, title: "Claim it", text: "Owners spot their item in the matches and message the finder." },
  { icon: MessagesSquare, title: "Hand it over", text: "Chat to agree a spot and time on campus." },
];

function Landing() {
  return (
    <div className="min-h-screen grid-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Button asChild variant="ink" size="sm"><Link to="/auth">Sign in</Link></Button>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-20 pt-10 md:pt-20">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="max-w-3xl">
          <span className="inline-block rounded-full border-2 border-foreground bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wider">Campus only</span>
          <h1 className="mt-5 text-5xl font-bold leading-[0.95] md:text-7xl">
            Lost it?<br /><span className="text-primary">Someone found it.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Report what you lost or found. We match it automatically, then connect owner and finder so they can arrange the handover.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="hero" size="xl"><Link to="/auth">Get started</Link></Button>
          </div>
        </motion.div>
        <div className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <motion.div key={s.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.08 }} className="panel p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-foreground bg-primary text-primary-foreground"><s.icon className="h-5 w-5" /></div>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}
