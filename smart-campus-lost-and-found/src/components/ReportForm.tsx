import { useNavigate, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Camera, ImagePlus, Loader2, Building2, Hand, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IMAGE_BUCKET, triggerMatching } from "@/lib/items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Kind = "lost" | "found";
type KeptWith = "finder" | "office";

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function ReportForm({ kind }: { kind: Kind }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [when, setWhen] = useState("");
  const [keptWith, setKeptWith] = useState<KeptWith>("finder");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => setWhen(localNow()), []);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | undefined | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10 MB");
      return;
    }
    setFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (kind === "found" && !file) { toast.error("A photo is required for found items"); return; }
    if (kind === "lost" && !description.trim()) { toast.error("Please describe the item"); return; }
    if (!location.trim()) { toast.error("Please tell us where"); return; }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Please sign in again");

      let photoPath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        photoPath = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(photoPath, file, { contentType: file.type });
        if (error) throw error;
      }

      let id: string;
      if (kind === "lost") {
        const { data, error } = await supabase
          .from("lost_items")
          .insert({
            user_id: userId,
            description: description.trim(),
            photo_path: photoPath,
            lost_location: location.trim(),
            date_lost: new Date(when).toISOString(),
          })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      } else {
        const { data, error } = await supabase
          .from("found_items")
          .insert({
            user_id: userId,
            photo_path: photoPath,
            description: description.trim() || null,
            found_location: location.trim(),
            date_found: new Date(when).toISOString(),
            kept_with: keptWith,
          })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }

      try {
        await triggerMatching(kind, id);
        toast.success("Report saved. We're checking for matches.");
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : "";
        toast.error(`Report saved, but matching could not be completed.${detail}`);
      }
      queryClient.invalidateQueries();
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save report");
    } finally {
      setBusy(false);
    }
  }

  const isFound = kind === "found";

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl px-5 py-8">
      <Link to="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm font-medium hover:underline"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
      <h1 className="text-4xl font-bold">{isFound ? "Report a found item" : "Report a lost item"}</h1>
      <p className="mt-2 text-muted-foreground">
        {isFound ? "A clear photo is all we need. Keep identifying details (contents, serial numbers) to yourself. They'll help check the owner." : "The more detail, the better the match. Describe colours, brand, marks and contents."}
      </p>

      <div className="mt-8 grid gap-6">
        <section className="panel p-5">
          <Label className="text-base font-semibold">Photo {isFound ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}</Label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            {...(isFound ? { capture: "environment" as const } : {})}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          {preview ? (
            <div className="relative mt-3 overflow-hidden rounded-lg border-2 border-foreground">
              <img src={preview} alt="Selected item" className="max-h-80 w-full object-contain bg-muted" />
              <button type="button" onClick={() => setFile(null)} aria-label="Remove photo" className="absolute right-2 top-2 rounded-full border-2 border-foreground bg-card p-1"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
              className={`mt-3 flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-foreground transition-colors ${dragOver ? "bg-accent" : "bg-muted hover:bg-secondary"}`}
            >
              {isFound ? <Camera className="h-10 w-10" /> : <ImagePlus className="h-10 w-10" />}
              <span className="font-semibold">{isFound ? "Take or upload a photo" : "Drop an image or browse your gallery"}</span>
              <span className="text-xs text-muted-foreground">JPG or PNG, up to 10 MB</span>
            </button>
          )}
        </section>

        <section className="panel grid gap-5 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="desc">
              Description {isFound ? <span className="font-normal text-muted-foreground">(optional)</span> : <span className="text-destructive">*</span>}
            </Label>
            <Textarea id="desc" rows={isFound ? 3 : 5} maxLength={2000} required={!isFound} value={description} onChange={(e) => setDescription(e.target.value)} className="border-2" placeholder={isFound ? "General look only. Don't reveal identifying details." : "Brand, colour, size, scratches, stickers, what was inside…"} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="loc">{isFound ? "Where did you find it?" : "Where did you lose it?"}</Label>
              <Input id="loc" required maxLength={300} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Library, 2nd floor" className="border-2" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="when">{isFound ? "When did you find it?" : "When did you lose it?"}</Label>
              <Input id="when" type="datetime-local" required max={localNow()} value={when} onChange={(e) => setWhen(e.target.value)} className="border-2" />
            </div>
          </div>
        </section>

        {isFound && (
          <section className="panel p-5">
            <Label className="text-base font-semibold">Where is the item now?</Label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                { v: "finder", label: "Kept with me", sub: "The owner can message you to arrange the handover", Icon: Hand },
                { v: "office", label: "Handed to Lost & Found Office", sub: "The office handles the return", Icon: Building2 },
              ] as const).map(({ v, label, sub, Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setKeptWith(v)}
                  aria-pressed={keptWith === v}
                  className={`flex items-start gap-3 rounded-lg border-2 border-foreground p-4 text-left transition-all ${keptWith === v ? "bg-accent shadow-brutal" : "bg-card hover:bg-muted"}`}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                  <span><span className="block font-semibold">{label}</span><span className="text-sm opacity-80">{sub}</span></span>
                </button>
              ))}
            </div>
          </section>
        )}

        <Button type="submit" variant={isFound ? "ink" : "hero"} size="xl" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "Saving…" : "Submit report"}
        </Button>
      </div>
    </form>
  );
}
