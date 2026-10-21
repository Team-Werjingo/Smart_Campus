import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ChatThread({ meId, lostId, foundId }: { meId: string; lostId: string; foundId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadKey = ["thread", lostId, foundId];

  const { data: messages = [], isLoading } = useQuery({
    queryKey: threadKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, sender_id, content, created_at")
        .eq("lost_id", lostId)
        .eq("found_id", foundId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Live updates need Realtime turned on for the "messages" table
  // (supabase/fixes.sql does it, or Supabase dashboard -> Database -> Publications -> supabase_realtime).
  useEffect(() => {
    const channel = supabase
      .channel(`thread-${lostId}-${foundId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `lost_id=eq.${lostId}` },
        (payload) => {
          if ((payload.new as { found_id?: string }).found_id !== foundId) return;
          queryClient.invalidateQueries({ queryKey: ["thread", lostId, foundId] });
          queryClient.invalidateQueries({ queryKey: ["conversations"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [lostId, foundId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase
        .from("messages")
        .insert({ lost_id: lostId, found_id: foundId, sender_id: meId, content });
      if (error) throw error;
    },
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["thread", lostId, foundId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Message not sent"),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || send.isPending) return;
    send.mutate(content);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-2 pr-1">
        {isLoading && <div className="h-10 animate-pulse rounded-lg border-2 border-foreground bg-muted" />}
        {!isLoading && messages.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-foreground p-4 text-sm text-muted-foreground">
            Say hello and describe something only the real owner would know.
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-xl border-2 border-foreground px-3 py-2 text-sm ${mine ? "bg-primary" : "bg-card"}`}>
                {m.content}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={onSubmit} className="flex gap-2 border-t-2 border-foreground pt-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" className="border-2" maxLength={2000} />
        <Button type="submit" variant="ink" size="icon" aria-label="Send" disabled={send.isPending || !text.trim()} className="h-9 w-10 shrink-0">
          {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
    </div>
  );
}
