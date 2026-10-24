import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Camera, MapPin, MessageCircle, Search, Sparkles, Clock, Lock, Hand } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppNav, useMe } from "@/components/AppNav";
import { ChatThread } from "@/components/ChatThread";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MATCHES_PER_ITEM } from "@/lib/campus";
import { loadConversations, shortText, signedUrls, timeAgo, type Conversation } from "@/lib/items";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Smart Campus Lost & Found" },
      { name: "description", content: "Your matches, claims and messages." },
      { property: "og:title", content: "Dashboard — Smart Campus Lost & Found" },
      { property: "og:description", content: "Your matches, claims and messages." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type MatchRow = {
  lost_id: string;
  found_id: string;
  score: number;
  lost: { id: string; description: string; user_id: string; status: string } | null;
  found: { id: string; photo_path: string | null; description: string | null; found_location: string; date_found: string; kept_with: string } | null;
};

type OpenChat = { lostId: string; foundId: string; title: string } | null;

function Dashboard() {
  const { data: me } = useMe();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chat, setChat] = useState<OpenChat>(null);

  function openChat(lostId: string, foundId: string, title: string) {
    setChat({ lostId, foundId, title });
    setSheetOpen(true);
  }
  function openInbox() {
    setChat(null);
    setSheetOpen(true);
  }

  const matchesQ = useQuery({
    queryKey: ["lost-matches", me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("score_comparison")
        .select(`lost_id, found_id, score,
          lost:lost_items!inner(id, description, user_id, status),
          found:found_items(id, photo_path, description, found_location, date_found, kept_with)`)
        .eq("lost.user_id", me!.id)
        .eq("lost.status", "open")
        .order("score", { ascending: false });
      if (error) throw error;

      const perItem = new Map<string, number>();
      const rows = (data ?? []) as unknown as MatchRow[];
      const top = rows.filter((m) => {
        if (!m.found) return false;
        const n = perItem.get(m.lost_id) ?? 0;
        perItem.set(m.lost_id, n + 1);
        return n < MATCHES_PER_ITEM;
      });
      const urls = await signedUrls(top.map((m) => m.found?.photo_path));
      return top.map((m) => ({ ...m, photo: m.found?.photo_path ? urls[m.found.photo_path] : null }));
    },
  });

  const convsQ = useQuery({
    queryKey: ["conversations", me?.id],
    enabled: !!me,
    queryFn: loadConversations,
  });

  const reportsQ = useQuery({
    queryKey: ["my-reports", me?.id],
    enabled: !!me,
    queryFn: async () => {
      const [lost, found] = await Promise.all([
        supabase.from("lost_items").select("id, description, lost_location, status, created_at").eq("user_id", me!.id).order("created_at", { ascending: false }).limit(12),
        supabase.from("found_items").select("id, description, found_location, kept_with, status, created_at").eq("user_id", me!.id).order("created_at", { ascending: false }).limit(12),
      ]);
      if (lost.error) throw lost.error;
      if (found.error) throw found.error;
      return [
        ...(lost.data ?? []).map((r) => ({ id: r.id as string, type: "lost" as const, title: shortText(r.description, 60, "Lost item"), place: r.lost_location as string, keptWith: null as string | null, status: r.status as string, created_at: r.created_at as string })),
        ...(found.data ?? []).map((r) => ({ id: r.id as string, type: "found" as const, title: shortText(r.description, 60, "Found item"), place: r.found_location as string, keptWith: r.kept_with as string, status: r.status as string, created_at: r.created_at as string })),
      ]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 12);
    },
  });

  const convs = convsQ.data ?? [];
  const claims = convs.filter((c) => c.found?.user_id === me?.id && c.found?.kept_with === "finder");
  const hasKeptFound = (reportsQ.data ?? []).some((r) => r.type === "found" && r.keptWith === "finder");
  const firstName = me?.full_name?.split(" ")[0];

  function convTitle(c: Conversation) {
    return shortText(c.found?.description, 40, "Found item");
  }

  const chatList = (
    <div className="space-y-2">
      {convs.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-foreground p-4 text-sm text-muted-foreground">
          <Lock className="mb-2 h-4 w-4" />
          No messages yet. Claim a match or wait for someone to claim your found item.
        </div>
      ) : (
        convs.map((c) => {
          const mineFound = c.found?.user_id === me?.id;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => openChat(c.lost_id, c.found_id, convTitle(c))}
              className="flex w-full items-center gap-3 rounded-lg border-2 border-foreground bg-card p-3 text-left transition-transform hover:-translate-y-0.5"
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{convTitle(c)}</div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{mineFound ? "Item you found" : "Item you're claiming"}</div>
                <div className="truncate text-xs text-muted-foreground">{c.last.sender_id === me?.id ? "You: " : ""}{c.last.content}</div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div className="min-h-screen">
      <AppNav onInbox={openInbox} />
      <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-10">
          <div>
            <h1 className="text-4xl font-bold">Hi{firstName ? `, ${firstName}` : ""}.</h1>
            <p className="mt-1 text-muted-foreground">What happened today?</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <motion.div whileHover={{ y: -3 }}>
              <Link to="/report/lost" className="group flex h-full flex-col justify-between rounded-2xl border-2 border-foreground bg-card p-6 shadow-brutal-lg">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Search className="h-6 w-6" />
                </div>
                <div className="mt-10">
                  <h2 className="text-2xl font-bold">Report Lost Item</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Describe it — we'll scan everything that's been found.</p>
                  <span className="mt-4 inline-flex items-center gap-1 font-semibold">Start <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
                </div>
              </Link>
            </motion.div>
            <motion.div whileHover={{ y: -3 }}>
              <Link to="/report/found" className="group flex h-full flex-col justify-between rounded-2xl border-2 border-foreground bg-card p-6 shadow-brutal-lg">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Camera className="h-6 w-6" />
                </div>
                <div className="mt-10">
                  <h2 className="text-2xl font-bold">Report Found Item</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Snap a photo and help it get home.</p>
                  <span className="mt-4 inline-flex items-center gap-1 font-semibold">Start <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
                </div>
              </Link>
            </motion.div>
          </div>

          <section>
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-2xl font-bold">Matches for your lost items</h2>
            </div>
            {matchesQ.isLoading ? (
              <div className="h-40 animate-pulse rounded-xl border-2 border-foreground bg-muted" />
            ) : (matchesQ.data ?? []).length === 0 ? (
              <div className="panel p-6 text-muted-foreground">No matches yet. When a found item looks like yours, it'll show up here.</div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {matchesQ.data!.map((m) => (
                  <motion.article key={`${m.lost_id}-${m.found_id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
                    <div className="relative aspect-[4/3] bg-muted">
                      {m.photo ? <img src={m.photo} alt={shortText(m.found?.description, 40, "Found item")} className="h-full w-full object-cover" /> : null}
                      <span className="absolute left-3 top-3 rounded-full border-2 border-foreground bg-primary px-2.5 py-0.5 text-sm font-bold">{Math.round(Number(m.score) * 100)}% match</span>
                    </div>
                    <div className="space-y-3 border-t-2 border-foreground p-4">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">For your “{shortText(m.lost?.description, 36, "lost item")}”</div>
                        <h3 className="text-lg font-semibold leading-tight">{shortText(m.found?.description, 60, "Found item")}</h3>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{m.found?.found_location}</span>
                        {m.found?.date_found && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(m.found.date_found)}</span>}
                      </div>
                      {m.found?.kept_with === "finder" ? (
                        <Button variant="ink" className="w-full" onClick={() => openChat(m.lost_id, m.found_id, shortText(m.found?.description, 40, "Found item"))}>
                          <MessageCircle /> This is mine — message
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-foreground p-2.5 text-xs font-medium">
                          <Building2 className="h-4 w-4 shrink-0" /> At the Lost & Found Office. Go there to collect it.
                        </div>
                      )}
                    </div>
                  </motion.article>
                ))}
              </div>
            )}
          </section>

          {hasKeptFound && (
            <section>
              <h2 className="mb-4 text-2xl font-bold">Claims on your found items</h2>
              {claims.length === 0 ? (
                <div className="panel p-6 text-muted-foreground">No one has claimed your found items yet.</div>
              ) : (
                <div className="panel divide-y-2 divide-foreground">
                  {claims.map((c) => (
                    <button key={c.key} type="button" onClick={() => openChat(c.lost_id, c.found_id, convTitle(c))} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{convTitle(c)}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.last.content} · {timeAgo(c.last.created_at)}</div>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-2 border-foreground">Open chat</Badge>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          <section>
            <h2 className="mb-4 text-2xl font-bold">Your reports</h2>
            {(reportsQ.data ?? []).length === 0 ? (
              <div className="panel p-6 text-muted-foreground">You haven't reported anything yet.</div>
            ) : (
              <div className="panel divide-y-2 divide-foreground">
                {reportsQ.data!.map((r) => (
                  <div key={`${r.type}-${r.id}`} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`rounded-md border-2 border-foreground px-2 py-0.5 text-xs font-bold uppercase ${r.type === "lost" ? "bg-primary" : "bg-accent"}`}>{r.type}</span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{r.title}</div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {r.place} · {timeAgo(r.created_at)}
                          {r.keptWith === "finder" && <Hand className="h-3 w-3" />}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 border-2 border-foreground capitalize">{r.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="hidden lg:block">
          <div className="panel sticky top-24 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><MessageCircle className="h-5 w-5" /> Messages</h2>
            {chatList}
          </div>
        </aside>
      </main>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex flex-col border-l-2 border-foreground">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {chat && (
                <button type="button" onClick={() => setChat(null)} aria-label="Back to inbox" className="rounded-md border-2 border-foreground p-1">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <span className="truncate">{chat ? chat.title : "Inbox"}</span>
            </SheetTitle>
          </SheetHeader>
          {chat && me ? (
            <ChatThread meId={me.id} lostId={chat.lostId} foundId={chat.foundId} />
          ) : (
            <div className="mt-4 overflow-y-auto">{chatList}</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
