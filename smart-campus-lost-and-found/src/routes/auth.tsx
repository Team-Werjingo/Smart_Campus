import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Logo } from "@/components/Logo";
import { CAMPUS_EMAIL_DOMAIN, isCampusEmail } from "@/lib/campus";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Smart Campus Lost & Found" },
      { name: "description", content: "Sign in or create your campus account to report and recover lost items." },
      { property: "og:title", content: "Sign in — Smart Campus Lost & Found" },
      { property: "og:description", content: "Create your campus account with email verification." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otp, setOtp] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCampusEmail(email)) {
      toast.error(`Please use your @${CAMPUS_EMAIL_DOMAIN} email`);
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard`, data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        setOtp("");
        setOtpOpen(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          if (error.message.toLowerCase().includes("confirm")) {
            setOtpOpen(true);
            await supabase.auth.resend({ type: "signup", email: email.trim() });
            return;
          }
          throw error;
        }
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // The email must contain the 6-digit code. In Supabase dashboard -> Authentication -> Email Templates
  // -> "Confirm signup", add {{ .Token }} to the template.
  async function verify() {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: otp, type: "signup" });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Account activated");
    setOtpOpen(false);
    navigate({ to: "/dashboard", replace: true });
  }

  async function resend() {
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
    if (error) toast.error(error.message);
    else toast.success("New code sent");
  }

  return (
    <div className="flex min-h-screen flex-col grid-paper">
      <header className="mx-auto w-full max-w-6xl px-5 py-5"><Logo /></header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="panel w-full max-w-md p-7">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border-2 border-foreground p-1">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md py-2 text-sm font-semibold transition-colors ${mode === m ? "bg-foreground text-background" : "hover:bg-muted"}`}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <h1 className="text-2xl font-bold">{mode === "signin" ? "Welcome back" : "Join your campus"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {CAMPUS_EMAIL_DOMAIN ? `Use your @${CAMPUS_EMAIL_DOMAIN} email.` : "Use your campus email address."}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="border-2" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Campus email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="border-2" placeholder={CAMPUS_EMAIL_DOMAIN ? `you@${CAMPUS_EMAIL_DOMAIN}` : "you@university.edu"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="border-2" />
            </div>
            <Button type="submit" variant="hero" size="xl" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>
      </main>

      <Dialog open={otpOpen} onOpenChange={setOtpOpen}>
        <DialogContent className="border-2 border-foreground">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg border-2 border-foreground bg-accent"><MailCheck className="h-5 w-5" /></div>
            <DialogTitle>Verify your email</DialogTitle>
            <DialogDescription>
              Enter the 6-digit code sent to <strong>{email}</strong>. You can also tap the link in that email.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <InputOTP maxLength={6} value={otp} onChange={setOtp}>
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} className="h-12 w-11 border-foreground text-lg" />)}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button variant="hero" size="lg" disabled={otp.length !== 6 || busy} onClick={verify}>
            {busy && <Loader2 className="animate-spin" />} Activate account
          </Button>
          <button type="button" onClick={resend} className="text-sm font-medium underline underline-offset-4">Resend code</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
