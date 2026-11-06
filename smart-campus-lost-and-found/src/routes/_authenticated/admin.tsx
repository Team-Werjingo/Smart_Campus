import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ImageOff,
  Loader2,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { AppNav, useMe } from "@/components/AppNav";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { signedUrls, shortText } from "@/lib/items";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin dashboard — Smart Campus Lost & Found" },
      { name: "description", content: "Campus lost and found administration." },
    ],
  }),
  component: AdminDashboard,
});

const PAGE_SIZE = 40;
const REPORT_TYPE_CHART: ChartConfig = {
  count: { label: "Reports", color: "var(--primary)" },
};

const LOCATION_CHART: ChartConfig = {
  count: { label: "Reports", color: "var(--chart-2)" },
};

type DashboardRange = "7d" | "30d" | "90d" | "all";

function rangeStart(range: DashboardRange) {
  if (range === "all") return null;
  const days = Number.parseInt(range, 10);
  const start = new Date();
  start.setDate(start.getDate() - days);
  return start.toISOString();
}

function rangeLabel(range: DashboardRange) {
  if (range === "all") return "All time";
  return `Last ${Number.parseInt(range, 10)} days`;
}

type AdminMatch = {
  lost_id: string;
  found_id: string;
  score: number;
  created_at: string;
  lost: { id: string; description: string; status: string } | null;
  found: {
    id: string;
    description: string | null;
    photo_path: string | null;
    found_location: string;
    date_found: string;
    kept_with: string;
    status: string;
  } | null;
  photo: string | null;
};

type OfficeItem = {
  id: string;
  description: string | null;
  photo_path: string | null;
  found_location: string;
  date_found: string;
  kept_with: string;
  status: string;
  created_at: string;
  photo: string | null;
};

type AdminUser = { user_id: string; full_name: string; email: string; role: "user" | "admin" | "superadmin" };

async function invokeMfa(action: "status" | "send" | "verify", code?: string) {
  const { data, error } = await supabase.functions.invoke("admin-mfa", { body: { action, code } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { verified?: boolean; sent?: boolean; expires_at?: string };
}

function AdminDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useMe();
  const [otp, setOtp] = useState("");
  const [selectedOfficeItem, setSelectedOfficeItem] = useState<OfficeItem | null>(null);
  const [matchPage, setMatchPage] = useState(0);
  const [officePage, setOfficePage] = useState(0);
  const [threshold, setThreshold] = useState("");
  const [dateRange, setDateRange] = useState<DashboardRange>("30d");

  const isSuperadmin = me?.role === "superadmin";
  const isAdmin = me?.role === "admin";
  const since = rangeStart(dateRange);
  const mfaQuery = useQuery({
    queryKey: ["admin-mfa", me?.id],
    queryFn: async () => (await invokeMfa("status")).verified === true,
    enabled: isSuperadmin,
    retry: false,
  });
  const canView = isAdmin || (isSuperadmin && mfaQuery.data === true);

  const statsQuery = useQuery({
    queryKey: ["admin-stats", dateRange],
    enabled: canView,
    queryFn: async () => {
      const lostQuery = supabase.from("lost_items").select("id", { count: "exact", head: true });
      const foundQuery = supabase.from("found_items").select("id", { count: "exact", head: true });
      const activeLostQuery = supabase.from("lost_items").select("id", { count: "exact", head: true }).eq("status", "open");
      const activeFoundQuery = supabase.from("found_items").select("id", { count: "exact", head: true }).eq("status", "open");
      const officeQuery = supabase.from("found_items").select("id", { count: "exact", head: true }).eq("kept_with", "office").eq("status", "open");
      const matchesQuery = supabase.from("score_comparison").select("lost_id", { count: "exact", head: true });
      const [lost, found, activeLost, activeFound, office, matches] = await Promise.all([
        since ? lostQuery.gte("created_at", since) : lostQuery,
        since ? foundQuery.gte("created_at", since) : foundQuery,
        since ? activeLostQuery.gte("created_at", since) : activeLostQuery,
        since ? activeFoundQuery.gte("created_at", since) : activeFoundQuery,
        since ? officeQuery.gte("created_at", since) : officeQuery,
        since ? matchesQuery.gte("created_at", since) : matchesQuery,
      ]);
      const error = [lost, found, activeLost, activeFound, office, matches].find((r) => r.error)?.error;
      if (error) throw error;
      return {
        lost: lost.count ?? 0,
        found: found.count ?? 0,
        active: (activeLost.count ?? 0) + (activeFound.count ?? 0),
        office: office.count ?? 0,
        matches: matches.count ?? 0,
      };
    },
  });

  const matchesQuery = useQuery({
    queryKey: ["admin-matches", matchPage, dateRange],
    enabled: canView,
    queryFn: async () => {
      const start = matchPage * PAGE_SIZE;
      let query = supabase
        .from("score_comparison")
        .select(`lost_id, found_id, score, created_at,
          lost:lost_items!inner(id, description, status),
          found:found_items!inner(id, description, photo_path, found_location, date_found, kept_with, status)`);
      if (since) query = query.gte("created_at", since);
      const { data, error } = await query
        .order("score", { ascending: false })
        .order("lost_id", { ascending: true })
        .order("found_id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Omit<AdminMatch, "photo">[];
      const urls = await signedUrls(rows.map((match) => match.found?.photo_path));
      return rows.map((match) => ({
        ...match,
        photo: match.found?.photo_path ? urls[match.found.photo_path] ?? null : null,
      })) as AdminMatch[];
    },
  });

  const officeQuery = useQuery({
    queryKey: ["admin-office-items", officePage, dateRange],
    enabled: canView,
    queryFn: async () => {
      const start = officePage * PAGE_SIZE;
      let query = supabase
        .from("found_items")
        .select("id, description, photo_path, found_location, date_found, kept_with, status, created_at")
        .eq("kept_with", "office")
        .eq("status", "open");
      if (since) query = query.gte("created_at", since);
      const { data, error } = await query
        .order("date_found", { ascending: false })
        .order("id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data ?? [];
      const urls = await signedUrls(rows.map((item) => item.photo_path));
      return rows.map((item) => ({
        ...item,
        photo: item.photo_path ? urls[item.photo_path] ?? null : null,
      })) as OfficeItem[];
    },
  });

  const recentReportsQuery = useQuery({
    queryKey: ["admin-recent-reports", dateRange],
    enabled: canView,
    queryFn: async () => {
      const lostQuery = supabase.from("lost_items").select("id, description, lost_location, status, created_at");
      const foundQuery = supabase.from("found_items").select("id, description, found_location, kept_with, status, created_at");
      const [lost, found] = await Promise.all([
        (since ? lostQuery.gte("created_at", since) : lostQuery).order("created_at", { ascending: false }).limit(25),
        (since ? foundQuery.gte("created_at", since) : foundQuery).order("created_at", { ascending: false }).limit(25),
      ]);
      if (lost.error) throw lost.error;
      if (found.error) throw found.error;
      return [
        ...(lost.data ?? []).map((item) => ({
          id: item.id,
          kind: "Lost",
          description: item.description ?? "Description not provided",
          location: item.lost_location,
          status: item.status,
          created_at: item.created_at,
          kept_with: null as string | null,
        })),
        ...(found.data ?? []).map((item) => ({
          id: item.id,
          kind: "Found",
          description: item.description ?? "Description not provided",
          location: item.found_location,
          status: item.status,
          created_at: item.created_at,
          kept_with: item.kept_with,
        })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
    },
  });

  const reportAnalyticsQuery = useQuery({
    queryKey: ["admin-report-analytics", dateRange],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_dashboard_analytics", { p_from: since });
      if (error) throw error;
      const byType = new Map<string, number>();
      const byLocation = new Map<string, number>();
      for (const row of data ?? []) {
        byType.set(row.report_kind, (byType.get(row.report_kind) ?? 0) + Number(row.report_count));
        byLocation.set(row.location, (byLocation.get(row.location) ?? 0) + Number(row.report_count));
      }
      return {
        byType: [...byType].map(([type, count]) => ({ type, count })),
        byLocation: [...byLocation]
          .map(([location, count]) => ({ location, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
      };
    },
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    enabled: canView && isSuperadmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admin_users");
      if (error) throw error;
      return (data ?? []) as AdminUser[];
    },
  });

  const thresholdQuery = useQuery({
    queryKey: ["admin-matching-threshold"],
    enabled: canView && isSuperadmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matching_settings")
        .select("cosine_threshold")
        .eq("singleton", true)
        .single();
      if (error) throw error;
      return Number(data.cosine_threshold);
    },
  });

  const sendOtp = useMutation({
    mutationFn: () => invokeMfa("send"),
    onSuccess: () => toast.success("A verification code was sent to your superadmin email."),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not send code"),
  });

  const verifyOtp = useMutation({
    mutationFn: () => invokeMfa("verify", otp),
    onSuccess: async () => {
      setOtp("");
      await queryClient.invalidateQueries({ queryKey: ["admin-mfa", me?.id] });
      toast.success("Superadmin session verified.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Code verification failed"),
  });

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "user" | "admin" }) => {
      const { error } = await supabase.rpc("set_user_role", { p_user_id: id, p_role: role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Account role updated");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update role"),
  });

  const saveThreshold = useMutation({
    mutationFn: async () => {
      const value = Number(threshold);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("Enter a value between 0 and 1.");
      }
      const { error } = await supabase.rpc("set_matching_threshold", { p_threshold: value });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-matching-threshold"] });
      toast.success("Match threshold saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save threshold"),
  });

  const stats = statsQuery.data;
  const currentMatches = matchesQuery.data ?? [];
  const currentOfficeItems = officeQuery.data ?? [];
  const reportAnalytics = reportAnalyticsQuery.data;

  if (meLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!isAdmin && !isSuperadmin) {
    return (
      <div className="min-h-screen">
        <AppNav />
        <main className="mx-auto max-w-3xl px-5 py-12">
          <section className="panel p-8 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
            <h1 className="mt-4 text-3xl font-bold">Admin access required</h1>
            <p className="mt-2 text-muted-foreground">Your account is a standard user. Only an administrator can enable the admin dashboard.</p>
            <Button className="mt-6" variant="hero" onClick={() => navigate({ to: "/dashboard" })}>Return to user dashboard</Button>
          </section>
        </main>
      </div>
    );
  }

  if (isSuperadmin && (mfaQuery.isLoading || !mfaQuery.data)) {
    const mfaError = mfaQuery.error;
    return (
      <div className="min-h-screen">
        <AppNav />
        <main className="mx-auto max-w-xl px-5 py-12">
          <section className="panel space-y-5 p-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-foreground bg-accent"><MailCheck className="h-6 w-6" /></div>
            <div>
              <Badge variant="outline" className="mb-3 border-2 border-foreground">Superadmin verification</Badge>
              <h1 className="text-3xl font-bold">Verify your email</h1>
              <p className="mt-2 text-sm text-muted-foreground">Superadmin access requires a fresh email one-time code for this signed-in session. Verification expires after four hours.</p>
            </div>
            {mfaError && <p role="alert" className="rounded-lg border-2 border-destructive p-3 text-sm">Could not check verification status. Confirm the admin-mfa function is deployed, then retry.</p>}
            <Button variant="hero" className="w-full" disabled={sendOtp.isPending} onClick={() => sendOtp.mutate()}>
              {sendOtp.isPending ? <Loader2 className="animate-spin" /> : <MailCheck />} Send email code
            </Button>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                verifyOtp.mutate();
              }}
            >
              <Label htmlFor="admin-otp">6-digit code</Label>
              <Input id="admin-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} className="border-2 text-lg tracking-[0.3em]" />
              <Button type="submit" className="w-full" disabled={otp.length !== 6 || verifyOtp.isPending}>
                {verifyOtp.isPending ? <Loader2 className="animate-spin" /> : <Check />} Verify and continue
              </Button>
            </form>
            <Button variant="ghost" className="w-full" onClick={() => navigate({ to: "/dashboard" })}><ArrowLeft /> Back to user dashboard</Button>
          </section>
        </main>
      </div>
    );
  }

  function loadMoreMatches() {
    setMatchPage((page) => page + 1);
  }

  function loadMoreOffice() {
    setOfficePage((page) => page + 1);
  }

  const thresholdValue = thresholdQuery.data;

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-7xl space-y-8 px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border-2 border-foreground bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wide">
              <ShieldCheck className="h-4 w-4" /> {isSuperadmin ? "Superadmin" : "Admin"} dashboard
            </div>
            <h1 className="text-4xl font-bold">Campus overview</h1>
            <p className="mt-1 text-muted-foreground">Live lost-and-found activity and AI match results.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold" htmlFor="dashboard-range">
              <CalendarDays className="h-4 w-4" /> Date range
            </label>
            <select
              id="dashboard-range"
              value={dateRange}
              onChange={(event) => {
                setDateRange(event.target.value as DashboardRange);
                setMatchPage(0);
                setOfficePage(0);
              }}
              className="rounded-md border-2 border-foreground bg-card px-3 py-2 text-sm font-semibold"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </select>
            <Button
              variant="outline"
              className="border-2 border-foreground"
              onClick={() => queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("admin-") })}
            >
              <RefreshCw className="h-4 w-4" /> Refresh dashboard
            </Button>
          </div>
        </div>

        {statsQuery.error && <ErrorBanner message="Dashboard statistics could not be loaded. Verify the admin RLS migration was applied." />}

        <section aria-label="Dashboard statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Lost reports" value={stats?.lost} hint={rangeLabel(dateRange)} />
          <StatCard label="Found reports" value={stats?.found} hint={rangeLabel(dateRange)} />
          <StatCard label="Open reports" value={stats?.active} hint={`${rangeLabel(dateRange)} · Lost + found`} />
          <StatCard label="Held at office" value={stats?.office} hint={`${rangeLabel(dateRange)} · Ready for collection`} />
          <StatCard label="AI comparisons" value={stats?.matches} hint={rangeLabel(dateRange)} />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="panel p-5">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              <div>
                <h2 className="text-xl font-bold">Reports by type</h2>
                <p className="text-sm text-muted-foreground">Lost and found submissions in {rangeLabel(dateRange).toLowerCase()}.</p>
              </div>
            </div>
            {reportAnalyticsQuery.error ? <ErrorBanner message="Report analytics could not be loaded." /> : reportAnalyticsQuery.isLoading ? <LoadingRows /> : reportAnalytics?.byType.length ? (
              <ChartContainer config={REPORT_TYPE_CHART} className="h-64 w-full aspect-auto">
                <BarChart data={reportAnalytics.byType} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="count" name="Reports" fill="var(--color-count)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : <p className="py-12 text-center text-sm text-muted-foreground">No reports in this date range.</p>}
          </div>

          <div className="panel p-5">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              <div>
                <h2 className="text-xl font-bold">Reports by location</h2>
                <p className="text-sm text-muted-foreground">Top campus locations in {rangeLabel(dateRange).toLowerCase()}.</p>
              </div>
            </div>
            {reportAnalyticsQuery.error ? <ErrorBanner message="Report analytics could not be loaded." /> : reportAnalyticsQuery.isLoading ? <LoadingRows /> : reportAnalytics?.byLocation.length ? (
              <ChartContainer config={LOCATION_CHART} className="h-64 w-full aspect-auto">
                <BarChart data={reportAnalytics.byLocation} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="location" tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={55} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="count" name="Reports" fill="var(--color-count)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : <p className="py-12 text-center text-sm text-muted-foreground">No reports in this date range.</p>}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-foreground p-5">
            <div>
              <h2 className="text-2xl font-bold">Score comparisons</h2>
              <p className="text-sm text-muted-foreground">Every lost/found match row, with the lost description, found photo and score.</p>
            </div>
            <Badge variant="outline" className="border-2 border-foreground">{stats?.matches ?? "—"} total</Badge>
          </div>
          {matchesQuery.isLoading ? <LoadingRows /> : matchesQuery.error ? (
            <ErrorBanner message="Match records could not be loaded. Check score_comparison and report-table admin SELECT policies." />
          ) : currentMatches.length === 0 && matchPage === 0 ? (
            <div className="p-8 text-center text-muted-foreground">There are no score_comparison rows yet.</div>
          ) : (
            <>
              <div className="divide-y-2 divide-foreground">
                {currentMatches.map((match) => (
                  <article key={`${match.lost_id}-${match.found_id}`} className="grid gap-4 p-4 sm:grid-cols-[112px_minmax(0,1fr)_112px] sm:items-center">
                    <div className="aspect-square overflow-hidden rounded-lg border-2 border-foreground bg-muted">
                      {match.photo ? <img src={match.photo} alt={shortText(match.found?.description, 40, "Found item")} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><ImageOff className="h-6 w-6 text-muted-foreground" /></div>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Lost description</p>
                      <p className="mt-0.5 font-semibold">{match.lost?.description || "Description not provided"}</p>
                      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Found item</p>
                      <p className="mt-0.5">{match.found?.description || "Description not provided"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{match.found?.found_location} · {match.found?.kept_with === "office" ? "At office" : "With finder"}</p>
                    </div>
                    <div className="flex flex-row items-center justify-between gap-3 sm:flex-col sm:items-end">
                      <Badge className="border-2 border-foreground bg-primary text-primary-foreground">{Math.round(Number(match.score) * 100)}% match</Badge>
                      <span className="text-xs capitalize text-muted-foreground">Lost: {match.lost?.status ?? "—"}</span>
                    </div>
                  </article>
                ))}
              </div>
              {(currentMatches.length === PAGE_SIZE || matchPage > 0) && (
                <div className="flex flex-wrap items-center justify-center gap-3 border-t-2 border-foreground p-4">
                  <Button variant="outline" className="border-2 border-foreground" disabled={matchPage === 0} onClick={() => setMatchPage((page) => page - 1)}>
                    <ArrowLeft /> Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">Page {matchPage + 1}</span>
                  <Button variant="outline" className="border-2 border-foreground" disabled={currentMatches.length < PAGE_SIZE} onClick={loadMoreMatches}>
                    Load more comparisons <ArrowDownToLine />
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center gap-3 border-b-2 border-foreground p-5">
            <Building2 className="h-6 w-6" />
            <div>
              <h2 className="text-2xl font-bold">Items held at the office</h2>
              <p className="text-sm text-muted-foreground">Office-held found items remain here with collection details and full-size images.</p>
            </div>
          </div>
          {officeQuery.isLoading ? <LoadingRows /> : officeQuery.error ? (
            <ErrorBanner message="Office-held found items could not be loaded." />
          ) : currentOfficeItems.length === 0 && officePage === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No found items are currently held by the office.</div>
          ) : (
            <>
              <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {currentOfficeItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setSelectedOfficeItem(item)}
                    className="group overflow-hidden rounded-xl border-2 border-foreground bg-card text-left shadow-brutal transition-transform hover:-translate-y-0.5"
                  >
                    <div className="relative aspect-[4/3] bg-muted">
                      {item.photo ? <img src={item.photo} alt={shortText(item.description, 45, "Found item")} className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" /> : <div className="flex h-full items-center justify-center"><ImageOff className="h-8 w-8 text-muted-foreground" /></div>}
                      <Badge className="absolute left-3 top-3 border-2 border-foreground bg-success text-success-foreground">At Lost &amp; Found Office</Badge>
                    </div>
                    <div className="space-y-1 p-4">
                      <h3 className="font-bold">{shortText(item.description, 72, "Found item — no description")}</h3>
                      <p className="text-sm text-muted-foreground">{item.found_location}</p>
                      <p className="text-xs capitalize text-muted-foreground">{item.status} · {new Date(item.date_found).toLocaleDateString()}</p>
                      <span className="mt-2 inline-flex text-sm font-semibold underline underline-offset-2">View item details</span>
                    </div>
                  </button>
                ))}
              </div>
              {(currentOfficeItems.length === PAGE_SIZE || officePage > 0) && (
                <div className="flex flex-wrap items-center justify-center gap-3 border-t-2 border-foreground p-4">
                  <Button variant="outline" className="border-2 border-foreground" disabled={officePage === 0} onClick={() => setOfficePage((page) => page - 1)}>
                    <ArrowLeft /> Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">Page {officePage + 1}</span>
                  <Button variant="outline" className="border-2 border-foreground" disabled={currentOfficeItems.length < PAGE_SIZE} onClick={loadMoreOffice}>
                    Load more office items <ArrowDownToLine />
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center gap-3 border-b-2 border-foreground p-5">
            <CalendarDays className="h-6 w-6" />
            <div>
              <h2 className="text-2xl font-bold">Recent reports</h2>
              <p className="text-sm text-muted-foreground">Latest lost and found submissions from across campus.</p>
            </div>
          </div>
          {recentReportsQuery.isLoading ? <LoadingRows /> : recentReportsQuery.error ? (
            <ErrorBanner message="Recent reports could not be loaded." />
          ) : (
            <div className="divide-y-2 divide-foreground">
              {(recentReportsQuery.data ?? []).map((report) => (
                <div key={`${report.kind}-${report.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge variant="outline" className={`border-2 border-foreground ${report.kind === "Lost" ? "bg-accent" : "bg-success"}`}>{report.kind}</Badge>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{shortText(report.description, 100, "Item report")}</p>
                      <p className="text-sm text-muted-foreground">{report.location} · {new Date(report.created_at).toLocaleString()}{report.kept_with === "office" ? " · Held at office" : ""}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="border-2 border-foreground capitalize">{report.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </section>

        {isSuperadmin && (
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="panel p-5">
              <div className="mb-4 flex items-center gap-3">
                <Users className="h-6 w-6" />
                <div>
                  <h2 className="text-2xl font-bold">Account roles</h2>
                  <p className="text-sm text-muted-foreground">Only the verified superadmin can grant or revoke admin access.</p>
                </div>
              </div>
              {usersQuery.error && <ErrorBanner message="User roles are unavailable. Check the superadmin RPC migration." />}
              {usersQuery.isLoading ? <LoadingRows /> : (
                <div className="max-h-[28rem] divide-y-2 divide-foreground overflow-y-auto">
                  {(usersQuery.data ?? []).map((user) => (
                    <div key={user.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{user.full_name || "Campus user"}</p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      {user.role === "superadmin" ? (
                        <Badge className="border-2 border-foreground bg-primary text-primary-foreground">Superadmin</Badge>
                      ) : (
                        <select
                          aria-label={`Role for ${user.email}`}
                          value={user.role}
                          disabled={setRole.isPending}
                          onChange={(event) => setRole.mutate({ id: user.user_id, role: event.target.value as "user" | "admin" })}
                          className="rounded-md border-2 border-foreground bg-card px-2 py-1.5 text-sm font-semibold"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel p-5">
              <div className="mb-4 flex items-center gap-3">
                <SlidersHorizontal className="h-6 w-6" />
                <div>
                  <h2 className="text-2xl font-bold">Match threshold</h2>
                  <p className="text-sm text-muted-foreground">Adjust the minimum cosine similarity used when generating future matches.</p>
                </div>
              </div>
              {thresholdQuery.error && <ErrorBanner message="Matching threshold is unavailable. Check matching_settings permissions." />}
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveThreshold.mutate();
                }}
              >
                <Label htmlFor="match-threshold">Cosine threshold (0–1)</Label>
                <Input
                  id="match-threshold"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  className="border-2"
                  value={threshold === "" ? thresholdValue ?? "" : threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                  disabled={thresholdQuery.isLoading || saveThreshold.isPending}
                />
                <Button type="submit" variant="hero" disabled={saveThreshold.isPending || thresholdQuery.isLoading}>
                  {saveThreshold.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save threshold
                </Button>
              </form>
              <p className="mt-4 text-xs text-muted-foreground">Changing the threshold affects matching runs after this update; existing score rows are not retroactively regenerated.</p>
            </div>
          </section>
        )}
      </main>

      <Dialog open={selectedOfficeItem !== null} onOpenChange={(open) => { if (!open) setSelectedOfficeItem(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-2 border-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{shortText(selectedOfficeItem?.description, 100, "Found item details")}</DialogTitle>
            <DialogDescription>Held at the campus Lost &amp; Found Office</DialogDescription>
          </DialogHeader>
          {selectedOfficeItem?.photo && (
            <a href={selectedOfficeItem.photo} target="_blank" rel="noreferrer" aria-label="Open full-size found item image">
              <img src={selectedOfficeItem.photo} alt={shortText(selectedOfficeItem.description, 80, "Found item")} className="max-h-[55vh] w-full rounded-lg border-2 border-foreground bg-muted object-contain" />
            </a>
          )}
          <dl className="grid gap-3 rounded-lg border-2 border-foreground bg-muted/40 p-4 sm:grid-cols-2">
            <Detail label="Description" value={selectedOfficeItem?.description || "Not provided"} />
            <Detail label="Found at" value={selectedOfficeItem?.found_location || "Not provided"} />
            <Detail label="Date found" value={selectedOfficeItem ? new Date(selectedOfficeItem.date_found).toLocaleString() : "—"} />
            <Detail label="Status" value={selectedOfficeItem?.status || "—"} />
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value?: number; hint: string }) {
  return (
    <div className="panel p-5">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-4xl font-bold">{value === undefined ? <span className="inline-block h-9 w-14 animate-pulse rounded bg-muted" /> : value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <p role="alert" className="m-4 rounded-lg border-2 border-destructive bg-destructive/5 p-3 text-sm">{message}</p>;
}

function LoadingRows() {
  return <div className="space-y-3 p-5" aria-label="Loading">
    {[0, 1, 2].map((row) => <div key={row} className="h-14 animate-pulse rounded-lg border-2 border-foreground bg-muted" />)}
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
}
