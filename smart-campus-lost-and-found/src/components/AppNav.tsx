import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox, Loader2, LogOut, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
      return { id: auth.user.id, email: auth.user.email ?? "", full_name: (data?.full_name as string | undefined) ?? "" };
    },
  });
}

export function AppNav({ onInbox }: { onInbox?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (profileOpen) setName(me?.full_name ?? "");
  }, [profileOpen, me?.full_name]);

  const saveName = useMutation({
    mutationFn: async (fullName: string) => {
      const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", me!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Name updated");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setProfileOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update name"),
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      toast.error("Name cannot be empty");
      return;
    }
    saveName.mutate(clean);
  }

  const initials = (me?.full_name || me?.email || "?").split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b-2 border-foreground bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <Logo />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onInbox ?? (() => navigate({ to: "/dashboard" }))}
            aria-label="Inbox"
            className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-foreground bg-card transition-transform hover:-translate-y-0.5"
          >
            <Inbox className="h-5 w-5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Account" className="rounded-full border-2 border-foreground">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-accent font-bold">{initials}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-2 border-foreground">
              <DropdownMenuLabel>
                <div className="font-semibold">{me?.full_name || "Student"}</div>
                <div className="text-xs font-normal text-muted-foreground">{me?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setProfileOpen(true)}><UserRound className="mr-2 h-4 w-4" /> Edit profile</DropdownMenuItem>
              <DropdownMenuItem onClick={signOut}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="border-2 border-foreground">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg border-2 border-foreground bg-accent"><UserRound className="h-5 w-5" /></div>
            <DialogTitle>Your profile</DialogTitle>
            <DialogDescription>{me?.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Full name</Label>
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="border-2" />
            </div>
            <Button type="submit" variant="hero" size="lg" className="w-full" disabled={saveName.isPending}>
              {saveName.isPending && <Loader2 className="animate-spin" />} Save name
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  );
}
