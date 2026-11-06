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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const adminEmail = Deno.env.get("ADMIN_EMAIL")?.trim().toLowerCase();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!adminEmail || !supabaseUrl || !serviceKey) {
    return reply({ error: "Admin bootstrap is not configured on the server" }, 503);
  }
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Sign in required" }, 401);

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice("Bearer ".length);
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user?.email) return reply({ error: "Invalid session" }, 401);

  if (authData.user.email.trim().toLowerCase() !== adminEmail) {
    return reply({ promoted: false });
  }

  const { data: existingSuperadmin, error: lookupError } = await client
    .from("profiles")
    .select("id")
    .eq("role", "superadmin")
    .maybeSingle();
  if (lookupError) return reply({ error: "Could not check the configured superadmin" }, 500);
  if (existingSuperadmin && existingSuperadmin.id !== authData.user.id) {
    return reply({ error: "A different superadmin is already configured" }, 409);
  }

  const { data: updatedProfile, error: updateError } = await client
    .from("profiles")
    .update({ role: "superadmin" })
    .eq("id", authData.user.id)
    .select("id")
    .maybeSingle();
  if (updateError) return reply({ error: "Could not assign the configured superadmin role" }, 500);
  if (!updatedProfile) return reply({ error: "The configured account does not have a profile yet" }, 404);

  return reply({ promoted: !existingSuperadmin, role: "superadmin" });
});
