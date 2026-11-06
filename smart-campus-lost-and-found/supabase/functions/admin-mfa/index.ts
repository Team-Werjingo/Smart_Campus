import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sessionIdFromJwt(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(normalized)) as { session_id?: unknown };
    return typeof claims.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return reply({ error: "MFA is not configured" }, 503);
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Sign in required" }, 401);

  const token = authorization.slice("Bearer ".length);
  const sessionId = sessionIdFromJwt(token);
  if (!sessionId) return reply({ error: "Session does not support MFA" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user?.email) return reply({ error: "Invalid session" }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) return reply({ error: "Could not verify account role" }, 500);
  if (profile?.role !== "superadmin") return reply({ error: "Superadmin account required" }, 403);

  let action: string;
  let code: string | undefined;
  try {
    const body = await request.json() as { action?: string; code?: string };
    action = body.action ?? "";
    code = body.code;
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }

  if (action === "status") {
    const { data, error } = await admin
      .from("admin_mfa_sessions")
      .select("expires_at")
      .eq("user_id", authData.user.id)
      .eq("session_id", sessionId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) return reply({ error: "Could not check verification status" }, 500);
    return reply({ verified: Boolean(data) });
  }

  if (action === "send") {
    const mailer = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await mailer.auth.signInWithOtp({
      email: authData.user.email,
      options: { shouldCreateUser: false },
    });
    if (error) return reply({ error: "Could not send verification email" }, 502);
    return reply({ sent: true });
  }

  if (action === "verify") {
    if (!code || !/^\d{6}$/.test(code)) return reply({ error: "Enter the 6-digit email code" }, 400);
    const verifier = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verification, error: verifyError } = await verifier.auth.verifyOtp({
      email: authData.user.email,
      token: code,
      type: "email",
    });
    if (verifyError || verification.user?.id !== authData.user.id) {
      return reply({ error: "The code is invalid, expired, or belongs to another account" }, 401);
    }

    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const { error: grantError } = await admin.from("admin_mfa_sessions").upsert({
      user_id: authData.user.id,
      session_id: sessionId,
      verified_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    if (grantError) return reply({ error: "Could not establish verified admin session" }, 500);
    return reply({ verified: true, expires_at: expiresAt });
  }

  return reply({ error: "Unsupported action" }, 400);
});
