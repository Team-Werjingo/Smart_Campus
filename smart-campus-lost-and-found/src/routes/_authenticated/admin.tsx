import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  ClipboardList,
  ImageOff,
  LayoutDashboard,
  Loader2,
  MailCheck,
  MessageSquareWarning,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { AppNav, useMe } from "@/components/AppNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
const REPORT_TYPE_CHART: ChartConfig = { count: { label: "Reports", color: "var(--primary)" } };
const LOCATION_CHART: ChartConfig = { count: { label: "Reports", color: "var(--chart-2)" } };

type DashboardRange = "7d" | "30d" | "90d" | "all";
type AdminSection = "dashboard" | "disputes" | "users" | "reports" | "matching" | "office" | "audit" | "settings";
type UserRole = "user" | "admin" | "superadmin";

const sections: { id: AdminSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "disputes", label: "Disputes", icon: MessageSquareWarning },
  { id: "users", label: "Users", icon: Users },
  { id: "reports", label: "Reports", icon: ClipboardList },
  { id: "matching", label: "Matching Performance", icon: Activity },
  { id: "office", label: "Office-Held Items", icon: Building2 },
  { id: "audit", label: "Audit Log", icon: ClipboardList },
  { id: "settings", label: "Settings", icon: Settings },
];

type AdminMatch = {
  lost_id: string;
  found_id: string;
  score: number;
  created_at: string;
  lost: { id: string; description: string | null; photo_path: string | null; status: string } | null;
  found: {
    id: string;
    description: string | null;
    photo_path: string | null;
    found_location: string;
    date_found: string;
    kept_with: string;
    status: string;
  } | null;
  foundPhoto: string | null;
  lostPhoto: string | null;
};

type AdminItem = {
  id: string;
  user_id: string;
  description: string | null;
  photo_path: string | null;
  location: string;
  date: string;
  status: string;
  kept_with?: string;
  photo: string | null;
};

type AdminUser = {
  user_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  lost_count: number;
  found_count: number;
  lost_returned_count: number;
  found_returned_count: number;
};

type PendingRoleChange = { user: AdminUser; role: "user" | "admin" } | null;
type ImagePreview = { url: string; title: string } | null;

function rangeStart(range: DashboardRange) {
  if (range === "all") return null;
  const start = new Date();
  start.setDate(start.getDate() - Number.parseInt(range, 10));
  return start.toISOString();
}

function rangeLabel(range: DashboardRange) {
  return range === "all" ? "All time" : `Last ${Number.parseInt(range, 10)} days`;
}

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
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [otp, setOtp] = useState("");
  const [matchPage, setMatchPage] = useState(0);
  const [officePage, setOfficePage] = useState(0);
  const [lostPage, setLostPage] = useState(0);
  const [foundPage, setFoundPage] = useState(0);
  const [threshold, setThreshold] = useState("");
  const [dateRange, setDateRange] = useState<DashboardRange>("30d");
  const [pendingRoleChange, setPendingRoleChange] = useState<PendingRoleChange>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreview>(null);

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
      const lost = supabase.from("lost_items").select("id", { count: "exact", head: true });
      const found = supabase.from("found_items").select("id", { count: "exact", head: true });
      const lostOpen = supabase.from("lost_items").select("id", { count: "exact", head: true }).eq("status", "open");
      const foundOpen = supabase.from("found_items").select("id", { count: "exact", head: true }).eq("status", "open");
      const returnedLost = supabase.from("lost_items").select("id", { count: "exact", head: true }).eq("status", "returned");
      const returnedFound = supabase.from("found_items").select("id", { count: "exact", head: true }).eq("status", "returned");
      const office = supabase.from("found_items").select("id", { count: "exact", head: true }).eq("kept_with", "office");
      const matches = supabase.from("score_comparison").select("lost_id", { count: "exact", head: true });
      const results = await Promise.all([
        since ? lost.gte("created_at", since) : lost,
        since ? found.gte("created_at", since) : found,
        since ? lostOpen.gte("created_at", since) : lostOpen,
        since ? foundOpen.gte("created_at", since) : foundOpen,
        since ? returnedLost.gte("created_at", since) : returnedLost,
        since ? returnedFound.gte("created_at", since) : returnedFound,
        since ? office.gte("created_at", since) : office,
        since ? matches.gte("created_at", since) : matches,
      ]);
      const error = results.find((result) => result.error)?.error;
      if (error) throw error;
      const [lostResult, foundResult, lostOpenResult, foundOpenResult, returnedLostResult, returnedFoundResult, officeResult, matchesResult] = results;
      return {
        lost: lostResult.count ?? 0,
        found: foundResult.count ?? 0,
        open: (lostOpenResult.count ?? 0) + (foundOpenResult.count ?? 0),
        returned: (returnedLostResult.count ?? 0) + (returnedFoundResult.count ?? 0),
        office: officeResult.count ?? 0,
        matches: matchesResult.count ?? 0,
      };
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
        byLocation: [...byLocation].map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      };
    },
  });

  const usersQuery = useQuery({
    queryKey: ["admin-dashboard-users"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admin_dashboard_users");
      if (error) throw error;
      return (data ?? []) as AdminUser[];
    },
  });

  const matchesQuery = useQuery({
    queryKey: ["admin-matches", matchPage],
    enabled: canView && section === "matching",
    queryFn: async () => {
      const start = matchPage * PAGE_SIZE;
      const { data, error } = await supabase
        .from("score_comparison")
        .select(`lost_id, found_id, score, created_at,
          lost:lost_items!inner(id, description, photo_path, status),
          found:found_items!inner(id, description, photo_path, found_location, date_found, kept_with, status)`)
        .order("score", { ascending: false })
        .order("lost_id", { ascending: true })
        .order("found_id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Omit<AdminMatch, "foundPhoto" | "lostPhoto">[];
      const urls = await signedUrls(rows.flatMap((row) => [row.found?.photo_path, row.lost?.photo_path]));
      return rows.map((row) => ({
        ...row,
        foundPhoto: row.found?.photo_path ? urls[row.found.photo_path] ?? null : null,
        lostPhoto: row.lost?.photo_path ? urls[row.lost.photo_path] ?? null : null,
      })) as AdminMatch[];
    },
  });

  const lostItemsQuery = useQuery({
    queryKey: ["admin-lost-reports", lostPage],
    enabled: canView && section === "reports",
    queryFn: async () => {
      const start = lostPage * PAGE_SIZE;
      const { data, error } = await supabase
        .from("lost_items")
        .select("id, user_id, description, photo_path, lost_location, date_lost, status")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data ?? [];
      const urls = await signedUrls(rows.map((item) => item.photo_path));
      return rows.map((item) => ({
        id: item.id,
        user_id: item.user_id,
        description: item.description,
        photo_path: item.photo_path,
        location: item.lost_location,
        date: item.date_lost,
        status: item.status,
        photo: item.photo_path ? urls[item.photo_path] ?? null : null,
      })) as AdminItem[];
    },
  });

  const foundItemsQuery = useQuery({
    queryKey: ["admin-found-reports", foundPage],
    enabled: canView && section === "reports",
    queryFn: async () => {
      const start = foundPage * PAGE_SIZE;
      const { data, error } = await supabase
        .from("found_items")
        .select("id, user_id, description, photo_path, found_location, date_found, kept_with, status")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data ?? [];
      const urls = await signedUrls(rows.map((item) => item.photo_path));
      return rows.map((item) => ({
        id: item.id,
        user_id: item.user_id,
        description: item.description,
        photo_path: item.photo_path,
        location: item.found_location,
        date: item.date_found,
        status: item.status,
        kept_with: item.kept_with,
        photo: item.photo_path ? urls[item.photo_path] ?? null : null,
      })) as AdminItem[];
    },
  });

  const officeQuery = useQuery({
    queryKey: ["admin-office-items", officePage],
    enabled: canView && section === "office",
    queryFn: async () => {
      const start = officePage * PAGE_SIZE;
      const { data, error } = await supabase
        .from("found_items")
        .select("id, user_id, description, photo_path, found_location, date_found, kept_with, status")
        .eq("kept_with", "office")
        .order("date_found", { ascending: false })
        .order("id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data ?? [];
      const urls = await signedUrls(rows.map((item) => item.photo_path));
      return rows.map((item) => ({
        id: item.id,
        user_id: item.user_id,
        description: item.description,
        photo_path: item.photo_path,
        location: item.found_location,
        date: item.date_found,
        kept_with: item.kept_with,
        status: item.status,
        photo: item.photo_path ? urls[item.photo_path] ?? null : null,
      })) as AdminItem[];
    },
  });

  const thresholdQuery = useQuery({
    queryKey: ["admin-matching-threshold"],
    enabled: canView && isSuperadmin && section === "settings",
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
    mutationFn: async (change: NonNullable<PendingRoleChange>) => {
      const { error } = await supabase.rpc("set_user_role", { p_user_id: change.user.user_id, p_role: change.role });
      if (error) throw error;
    },
    onSuccess: async () => {
      setPendingRoleChange(null);
      toast.success("Account role updated");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-dashboard-users"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update role"),
  });

  const saveThreshold = useMutation({
    mutationFn: async () => {
      const value = Number(threshold);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Enter a value between 0 and 1.");
      const { error } = await supabase.rpc("set_matching_threshold", { p_threshold: value });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-matching-threshold"] });
      setThreshold("");
      toast.success("Match threshold saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save threshold"),
  });

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
            {mfaQuery.error && <ErrorBanner message="Could not check verification status. Confirm the admin-mfa function is deployed, then retry." />}
            <Button variant="hero" className="w-full" disabled={sendOtp.isPending} onClick={() => sendOtp.mutate()}>
              {sendOtp.isPending ? <Loader2 className="animate-spin" /> : <MailCheck />} Send email code
            </Button>
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); verifyOtp.mutate(); }}>
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

  const stats = statsQuery.data;
  const analytics = reportAnalyticsQuery.data;
  const returnedRate = stats && stats.lost + stats.found > 0
    ? Math.round((stats.returned / (stats.lost + stats.found)) * 100)
    : 0;

  return (
    <div className="min-h-screen">
      <AppNav />
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6">
        <aside className="w-full shrink-0 lg:sticky lg:top-24 lg:h-[calc(100vh-7rem)] lg:w-64">
          <nav aria-label="Admin sections" className="panel flex gap-1 overflow-x-auto p-2 lg:h-full lg:flex-col lg:overflow-y-auto">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSection(id)}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors lg:w-full ${section === id ? "bg-foreground text-background" : "hover:bg-muted"}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
            <div className="mt-auto hidden border-t-2 border-foreground px-3 pt-4 text-xs text-muted-foreground lg:block">
              Signed in as <span className="font-semibold text-foreground">{isSuperadmin ? "Superadmin" : "Admin"}</span>
            </div>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border-2 border-foreground bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wide">
                <ShieldCheck className="h-4 w-4" /> {isSuperadmin ? "Superadmin" : "Admin"}
              </div>
              <h1 className="text-3xl font-bold sm:text-4xl">{sections.find((item) => item.id === section)?.label}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{sectionDescription(section)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {section === "dashboard" && (
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarDays className="h-4 w-4" />
                  <select
                    value={dateRange}
                    onChange={(event) => setDateRange(event.target.value as DashboardRange)}
                    aria-label="Analytics date range"
                    className="rounded-md border-2 border-foreground bg-card px-3 py-2"
                  >
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                    <option value="all">All time</option>
                  </select>
                </label>
              )}
              <Button
                variant="outline"
                className="border-2 border-foreground"
                onClick={() => queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("admin-") })}
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
            </div>
          </div>

          {section === "dashboard" && (
            <DashboardSection
              stats={stats}
              statsError={statsQuery.error}
              analytics={analytics}
              analyticsLoading={reportAnalyticsQuery.isLoading}
              analyticsError={reportAnalyticsQuery.error}
              dateRange={dateRange}
              returnedRate={returnedRate}
            />
          )}

          {section === "disputes" && <EmptySection title="No disputes yet" message="Dispute management will be available here when disputes are added to the app." />}

          {section === "users" && (
            <UsersSection
              users={usersQuery.data ?? []}
              isLoading={usersQuery.isLoading}
              error={usersQuery.error}
              isSuperadmin={isSuperadmin}
              currentUserId={me?.id}
              onChangeRole={setPendingRoleChange}
            />
          )}

          {section === "reports" && (
            <ReportsSection
              lostItems={lostItemsQuery.data ?? []}
              foundItems={foundItemsQuery.data ?? []}
              lostLoading={lostItemsQuery.isLoading}
              foundLoading={foundItemsQuery.isLoading}
              lostError={lostItemsQuery.error}
              foundError={foundItemsQuery.error}
              lostPage={lostPage}
              foundPage={foundPage}
              setLostPage={setLostPage}
              setFoundPage={setFoundPage}
              onImage={setImagePreview}
            />
          )}

          {section === "matching" && (
            <MatchingSection
              matches={matchesQuery.data ?? []}
              isLoading={matchesQuery.isLoading}
              error={matchesQuery.error}
              page={matchPage}
              setPage={setMatchPage}
              onImage={setImagePreview}
            />
          )}

          {section === "office" && (
            <OfficeSection
              items={officeQuery.data ?? []}
              isLoading={officeQuery.isLoading}
              error={officeQuery.error}
              page={officePage}
              setPage={setOfficePage}
              onImage={setImagePreview}
            />
          )}

          {section === "audit" && <EmptySection title="Audit log is empty" message="Administrative activity will appear here when audit logging is added." />}

          {section === "settings" && (
            <SettingsSection
              isSuperadmin={isSuperadmin}
              threshold={threshold}
              setThreshold={setThreshold}
              currentThreshold={thresholdQuery.data}
              isLoading={thresholdQuery.isLoading}
              error={thresholdQuery.error}
              isSaving={saveThreshold.isPending}
              onSave={() => saveThreshold.mutate()}
            />
          )}
        </main>
      </div>

      <AlertDialog open={pendingRoleChange !== null} onOpenChange={(open) => { if (!open && !setRole.isPending) setPendingRoleChange(null); }}>
        <AlertDialogContent className="border-2 border-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm role change</AlertDialogTitle>
            <AlertDialogDescription>
              Change {pendingRoleChange?.user.full_name || pendingRoleChange?.user.email} from{" "}
              <strong>{pendingRoleChange?.user.role}</strong> to <strong>{pendingRoleChange?.role}</strong>?
              This changes their access to the admin dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setRole.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={setRole.isPending} onClick={(event) => {
              event.preventDefault();
              if (pendingRoleChange) setRole.mutate(pendingRoleChange);
            }}>
              {setRole.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm role change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={imagePreview !== null} onOpenChange={(open) => { if (!open) setImagePreview(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-2 border-foreground sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{imagePreview?.title}</DialogTitle>
            <DialogDescription>Item photo</DialogDescription>
          </DialogHeader>
          {imagePreview && <img src={imagePreview.url} alt={imagePreview.title} className="max-h-[72vh] w-full rounded-lg border-2 border-foreground bg-muted object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function sectionDescription(section: AdminSection) {
  switch (section) {
    case "dashboard": return "Live lost-and-found activity and reports.";
    case "disputes": return "Review and resolve reported disputes.";
    case "users": return "Accounts, item totals, returns, and access roles.";
    case "reports": return "Browse lost and found submissions.";
    case "matching": return "Review every generated lost-and-found score comparison.";
    case "office": return "Items currently kept by the Lost & Found office.";
    case "audit": return "Administrative activity history.";
    case "settings": return "Configure matching behavior.";
  }
}

function DashboardSection({
  stats,
  statsError,
  analytics,
  analyticsLoading,
  analyticsError,
  dateRange,
  returnedRate,
}: {
  stats?: { lost: number; found: number; open: number; returned: number; office: number; matches: number };
  statsError: unknown;
  analytics?: { byType: { type: string; count: number }[]; byLocation: { location: string; count: number }[] };
  analyticsLoading: boolean;
  analyticsError: unknown;
  dateRange: DashboardRange;
  returnedRate: number;
}) {
  return (
    <div className="space-y-6">
      {statsError && <ErrorBanner message="Dashboard statistics could not be loaded. Verify the admin RLS migration was applied." />}
      <section aria-label="Dashboard statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Lost reports" value={stats?.lost} hint={rangeLabel(dateRange)} />
        <StatCard label="Found reports" value={stats?.found} hint={rangeLabel(dateRange)} />
        <StatCard label="Open reports" value={stats?.open} hint={rangeLabel(dateRange)} />
        <StatCard label="Returned reports" value={stats?.returned} hint={`${returnedRate}% of reports`} />
        <StatCard label="Return rate" value={`${returnedRate}%`} hint="Returned / total reports" />
        <StatCard label="Held at office" value={stats?.office} hint="Items with office" />
        <StatCard label="AI comparisons" value={stats?.matches} hint="All score rows" />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="panel p-5">
          <h2 className="text-xl font-bold">Reports by category</h2>
          <p className="mb-3 text-sm text-muted-foreground">Lost and found reports in {rangeLabel(dateRange).toLowerCase()}.</p>
          {analyticsError ? <ErrorBanner message="Report analytics could not be loaded." /> : analyticsLoading ? <LoadingRows /> : analytics?.byType.length ? (
            <ChartContainer config={REPORT_TYPE_CHART} className="h-64 w-full aspect-auto">
              <BarChart data={analytics.byType} accessibilityLayer>
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
          <h2 className="text-xl font-bold">Reports by location</h2>
          <p className="mb-3 text-sm text-muted-foreground">Top campus locations in {rangeLabel(dateRange).toLowerCase()}.</p>
          {analyticsError ? <ErrorBanner message="Report analytics could not be loaded." /> : analyticsLoading ? <LoadingRows /> : analytics?.byLocation.length ? (
            <ChartContainer config={LOCATION_CHART} className="h-64 w-full aspect-auto">
              <BarChart data={analytics.byLocation} accessibilityLayer>
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
    </div>
  );
}

function UsersSection({
  users,
  isLoading,
  error,
  isSuperadmin,
  currentUserId,
  onChangeRole,
}: {
  users: AdminUser[];
  isLoading: boolean;
  error: unknown;
  isSuperadmin: boolean;
  currentUserId?: string;
  onChangeRole: (change: NonNullable<PendingRoleChange>) => void;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-foreground p-5">
        <div>
          <h2 className="text-xl font-bold">Campus users</h2>
          <p className="text-sm text-muted-foreground">Lost/found totals and reports marked returned for each account.</p>
        </div>
        <Badge variant="outline" className="border-2 border-foreground">{users.length} users</Badge>
      </div>
      {error ? <ErrorBanner message="User list could not be loaded. Apply the latest admin dashboard SQL update." /> : isLoading ? <LoadingRows /> : users.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">No user accounts found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide">
              <tr>
                <th className="p-3">User</th>
                <th className="p-3">Lost</th>
                <th className="p-3">Lost returned</th>
                <th className="p-3">Found</th>
                <th className="p-3">Found returned</th>
                <th className="p-3">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-foreground/10">
              {users.map((user) => (
                <tr key={user.user_id}>
                  <td className="p-3">
                    <p className="font-semibold">{user.full_name || "Campus user"}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </td>
                  <td className="p-3">{Number(user.lost_count)}</td>
                  <td className="p-3">{Number(user.lost_returned_count)}</td>
                  <td className="p-3">{Number(user.found_count)}</td>
                  <td className="p-3">{Number(user.found_returned_count)}</td>
                  <td className="p-3">
                    {isSuperadmin && user.role !== "superadmin" && user.user_id !== currentUserId ? (
                      <select
                        aria-label={`Change role for ${user.email}`}
                        value={user.role}
                        onChange={(event) => {
                          const role = event.target.value as "user" | "admin";
                          if (role !== user.role) onChangeRole({ user, role });
                        }}
                        className="rounded-md border-2 border-foreground bg-card px-2 py-1.5 font-semibold"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <Badge variant="outline" className="border-2 border-foreground capitalize">{user.role}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReportsSection({
  lostItems,
  foundItems,
  lostLoading,
  foundLoading,
  lostError,
  foundError,
  lostPage,
  foundPage,
  setLostPage,
  setFoundPage,
  onImage,
}: {
  lostItems: AdminItem[];
  foundItems: AdminItem[];
  lostLoading: boolean;
  foundLoading: boolean;
  lostError: unknown;
  foundError: unknown;
  lostPage: number;
  foundPage: number;
  setLostPage: (page: number) => void;
  setFoundPage: (page: number) => void;
  onImage: (preview: NonNullable<ImagePreview>) => void;
}) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <ReportList title="Lost items" items={lostItems} isLoading={lostLoading} error={lostError} page={lostPage} setPage={setLostPage} onImage={onImage} />
      <ReportList title="Found items" items={foundItems} isLoading={foundLoading} error={foundError} page={foundPage} setPage={setFoundPage} onImage={onImage} />
    </div>
  );
}

function ReportList({
  title,
  items,
  isLoading,
  error,
  page,
  setPage,
  onImage,
}: {
  title: string;
  items: AdminItem[];
  isLoading: boolean;
  error: unknown;
  page: number;
  setPage: (page: number) => void;
  onImage: (preview: NonNullable<ImagePreview>) => void;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b-2 border-foreground p-4">
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {error ? <ErrorBanner message={`${title} could not be loaded.`} /> : isLoading ? <LoadingRows /> : items.length === 0 && page === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No {title.toLowerCase()} found.</p>
      ) : (
        <>
          <div className="divide-y-2 divide-foreground/10">
            {items.map((item) => <ReportRow key={item.id} item={item} onImage={onImage} />)}
          </div>
          <PageControls page={page} canNext={items.length === PAGE_SIZE} setPage={setPage} noun={title.toLowerCase()} />
        </>
      )}
    </section>
  );
}

function ReportRow({ item, onImage }: { item: AdminItem; onImage: (preview: NonNullable<ImagePreview>) => void }) {
  return (
    <article className="flex gap-3 p-3">
      <ItemThumbnail item={item} onImage={onImage} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-semibold">{item.description || "Description not provided"}</p>
        <p className="mt-1 text-xs text-muted-foreground">{item.location || "Location not provided"}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.date)} · {item.status}{item.kept_with ? ` · ${item.kept_with}` : ""}</p>
      </div>
    </article>
  );
}

function MatchingSection({
  matches,
  isLoading,
  error,
  page,
  setPage,
  onImage,
}: {
  matches: AdminMatch[];
  isLoading: boolean;
  error: unknown;
  page: number;
  setPage: (page: number) => void;
  onImage: (preview: NonNullable<ImagePreview>) => void;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-foreground p-5">
        <div>
          <h2 className="text-xl font-bold">Score comparisons</h2>
          <p className="text-sm text-muted-foreground">Found image and optional lost image on the left; lost description and optional found description on the right.</p>
        </div>
      </div>
      {error ? <ErrorBanner message="Score comparisons could not be loaded. Check the admin RLS policies." /> : isLoading ? <LoadingRows /> : matches.length === 0 && page === 0 ? (
        <p className="p-8 text-center text-muted-foreground">There are no score_comparison rows yet.</p>
      ) : (
        <>
          <div className="divide-y-2 divide-foreground/10">
            {matches.map((match) => (
              <article key={`${match.lost_id}-${match.found_id}`} className="grid gap-4 p-4 lg:grid-cols-[112px_minmax(0,1fr)_112px_minmax(0,1fr)] lg:items-center">
                <MatchImage url={match.foundPhoto} label={shortText(match.found?.description, 40, "Found item")} onImage={onImage} />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Lost description</p>
                  <p className="mt-1 whitespace-pre-wrap font-semibold">{match.lost?.description || "Description not provided"}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Lost item · {match.lost?.status ?? "—"}</p>
                </div>
                <div className="flex justify-start lg:justify-center">
                  <Badge className="border-2 border-foreground bg-primary text-primary-foreground">{Math.round(Number(match.score) * 100)}% similarity</Badge>
                </div>
                <div className="flex min-w-0 items-start gap-3">
                  {match.lostPhoto && <MatchImage url={match.lostPhoto} label={shortText(match.lost?.description, 40, "Lost item")} onImage={onImage} />}
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Found description (optional)</p>
                    <p className="mt-1 whitespace-pre-wrap">{match.found?.description || "No found-side description"}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{match.found?.found_location || "Location not provided"} · {match.found?.kept_with === "office" ? "At office" : "With finder"}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <PageControls page={page} canNext={matches.length === PAGE_SIZE} setPage={setPage} noun="comparisons" />
        </>
      )}
    </section>
  );
}

function OfficeSection({
  items,
  isLoading,
  error,
  page,
  setPage,
  onImage,
}: {
  items: AdminItem[];
  isLoading: boolean;
  error: unknown;
  page: number;
  setPage: (page: number) => void;
  onImage: (preview: NonNullable<ImagePreview>) => void;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b-2 border-foreground p-5">
        <h2 className="text-xl font-bold">Items held at the office</h2>
        <p className="text-sm text-muted-foreground">All found items marked as kept with the office.</p>
      </div>
      {error ? <ErrorBanner message="Office-held items could not be loaded." /> : isLoading ? <LoadingRows /> : items.length === 0 && page === 0 ? (
        <p className="p-8 text-center text-muted-foreground">No items are currently kept with the office.</p>
      ) : (
        <>
          <div className="divide-y-2 divide-foreground/10">
            {items.map((item) => (
              <article key={item.id} className="flex flex-wrap items-center gap-4 p-4">
                <ItemThumbnail item={item} onImage={onImage} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold">{item.description || "Found item — no description"}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.location || "Location not provided"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Found {formatDate(item.date)} · {item.status}</p>
                </div>
                <Badge variant="outline" className="border-2 border-foreground">Office-held</Badge>
              </article>
            ))}
          </div>
          <PageControls page={page} canNext={items.length === PAGE_SIZE} setPage={setPage} noun="office items" />
        </>
      )}
    </section>
  );
}

function SettingsSection({
  isSuperadmin,
  threshold,
  setThreshold,
  currentThreshold,
  isLoading,
  error,
  isSaving,
  onSave,
}: {
  isSuperadmin: boolean;
  threshold: string;
  setThreshold: (value: string) => void;
  currentThreshold?: number;
  isLoading: boolean;
  error: unknown;
  isSaving: boolean;
  onSave: () => void;
}) {
  if (!isSuperadmin) return <EmptySection title="No settings available" message="Only the superadmin can change matching settings." />;
  return (
    <section className="panel max-w-3xl p-5">
      <div className="mb-5 flex items-center gap-3">
        <SlidersHorizontal className="h-6 w-6" />
        <div>
          <h2 className="text-xl font-bold">Matching threshold</h2>
          <p className="text-sm text-muted-foreground">Set the minimum cosine similarity for future matches.</p>
        </div>
      </div>
      {error && <ErrorBanner message="Matching threshold is unavailable. Check matching_settings permissions." />}
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <Label htmlFor="match-threshold">Threshold: {threshold || currentThreshold?.toFixed(2) || "—"}</Label>
        <input
          id="match-threshold"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={threshold === "" ? currentThreshold ?? 0 : threshold}
          onChange={(event) => setThreshold(event.target.value)}
          disabled={isLoading || isSaving}
          className="w-full accent-primary"
        />
        <Input
          type="number"
          min="0"
          max="1"
          step="0.01"
          aria-label="Threshold value"
          className="max-w-40 border-2"
          value={threshold === "" ? currentThreshold ?? "" : threshold}
          onChange={(event) => setThreshold(event.target.value)}
          disabled={isLoading || isSaving}
        />
        <Button type="submit" variant="hero" disabled={isSaving || isLoading}>
          {isSaving ? <Loader2 className="animate-spin" /> : <Check />} Save settings
        </Button>
      </form>
      <p className="mt-4 text-xs text-muted-foreground">Existing comparisons are not recalculated when the threshold changes.</p>
    </section>
  );
}

function ItemThumbnail({ item, onImage }: { item: AdminItem; onImage: (preview: NonNullable<ImagePreview>) => void }) {
  if (!item.photo) {
    return <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border-2 border-foreground bg-muted"><ImageOff className="h-6 w-6 text-muted-foreground" /></div>;
  }
  return (
    <button
      type="button"
      onClick={() => onImage({ url: item.photo!, title: shortText(item.description, 60, "Item photo") })}
      className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-foreground bg-muted"
      aria-label={`Enlarge ${shortText(item.description, 50, "item")} photo`}
    >
      <img src={item.photo} alt={shortText(item.description, 50, "Item")} className="h-full w-full object-cover" />
    </button>
  );
}

function MatchImage({
  url,
  label,
  onImage,
}: {
  url: string | null;
  label: string;
  onImage: (preview: NonNullable<ImagePreview>) => void;
}) {
  return url ? (
    <button type="button" onClick={() => onImage({ url, title: label })} aria-label={`Enlarge ${label} photo`} className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-foreground bg-muted">
      <img src={url} alt={label} className="h-full w-full object-cover" />
    </button>
  ) : (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border-2 border-foreground bg-muted"><ImageOff className="h-6 w-6 text-muted-foreground" /></div>
  );
}

function PageControls({ page, canNext, setPage, noun }: { page: number; canNext: boolean; setPage: (page: number) => void; noun: string }) {
  if (!canNext && page === 0) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-t-2 border-foreground p-3">
      <Button variant="outline" className="border-2 border-foreground" disabled={page === 0} onClick={() => setPage(page - 1)}>
        <ArrowLeft /> Previous
      </Button>
      <span className="text-sm text-muted-foreground">Page {page + 1}</span>
      <Button variant="outline" className="border-2 border-foreground" disabled={!canNext} onClick={() => setPage(page + 1)}>
        Next {noun} <ArrowDownToLine />
      </Button>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value?: number | string; hint: string }) {
  return (
    <div className="panel p-4">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value === undefined ? <span className="inline-block h-8 w-14 animate-pulse rounded bg-muted" /> : typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function EmptySection({ title, message }: { title: string; message: string }) {
  return (
    <section className="panel flex min-h-64 flex-col items-center justify-center p-8 text-center">
      <MessageSquareWarning className="h-9 w-9 text-muted-foreground" />
      <h2 className="mt-4 text-xl font-bold">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <p role="alert" className="m-4 rounded-lg border-2 border-destructive bg-destructive/5 p-3 text-sm">{message}</p>;
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-5" aria-label="Loading">
      {[0, 1, 2].map((row) => <div key={row} className="h-14 animate-pulse rounded-lg border-2 border-foreground bg-muted" />)}
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString();
}
