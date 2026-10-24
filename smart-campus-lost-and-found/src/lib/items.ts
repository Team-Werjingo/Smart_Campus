import { supabase } from "@/integrations/supabase/client";

// Storage bucket for item photos. Create it in Supabase dashboard -> Storage -> New bucket
// (name: report-images, keep it private). The SQL in supabase/fixes.sql does this for you.
export const IMAGE_BUCKET = "report-images";

export async function signedUrls(paths: (string | null | undefined)[]) {
  const clean = [...new Set(paths.filter(Boolean) as string[])];
  const map: Record<string, string> = {};
  if (!clean.length) return map;
  const { data } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(clean, 3600);
  data?.forEach((d) => {
    if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
  });
  return map;
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function shortText(text: string | null | undefined, max = 60, fallback = "Item") {
  const t = (text ?? "").trim();
  if (!t) return fallback;
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

export async function triggerMatching(
  type: "lost" | "found",
  id: string,
  embeddings: { imageEmbedding?: number[]; textEmbedding?: number[] },
) {
  const { error } = await supabase.functions.invoke("embed-item", {
    body: {
      type,
      id,
      image_embedding: embeddings.imageEmbedding ?? null,
      text_embedding: embeddings.textEmbedding ?? null,
    },
  });
  if (error) throw error;
}

export type Conversation = {
  key: string;
  lost_id: string;
  found_id: string;
  last: { content: string; sender_id: string; created_at: string };
  found: {
    id: string;
    user_id: string;
    photo_path: string | null;
    description: string | null;
    found_location: string;
    kept_with: string;
  } | null;
  lost: { id: string; description: string } | null;
};

export async function loadConversations(): Promise<Conversation[]> {
  const { data: msgs, error } = await supabase
    .from("messages")
    .select("lost_id, found_id, sender_id, content, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const latest = new Map<string, NonNullable<typeof msgs>[number]>();
  for (const m of msgs ?? []) {
    const key = `${m.lost_id}|${m.found_id}`;
    if (!latest.has(key)) latest.set(key, m);
  }
  const list = [...latest.entries()];
  if (!list.length) return [];

  const [foundRes, lostRes] = await Promise.all([
    supabase
      .from("found_items")
      .select("id, user_id, photo_path, description, found_location, kept_with")
      .in("id", [...new Set(list.map(([, m]) => m.found_id))]),
    supabase
      .from("lost_items")
      .select("id, description")
      .in("id", [...new Set(list.map(([, m]) => m.lost_id))]),
  ]);
  const foundBy = new Map((foundRes.data ?? []).map((f) => [f.id, f]));
  const lostBy = new Map((lostRes.data ?? []).map((l) => [l.id, l]));

  return list.map(([key, m]) => ({
    key,
    lost_id: m.lost_id,
    found_id: m.found_id,
    last: { content: m.content, sender_id: m.sender_id, created_at: m.created_at },
    found: foundBy.get(m.found_id) ?? null,
    lost: lostBy.get(m.lost_id) ?? null,
  }));
}
