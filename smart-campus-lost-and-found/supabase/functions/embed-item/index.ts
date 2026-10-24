import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMBEDDING_DIMENSIONS = 512;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ItemType = "lost" | "found";
type Embedding = number[];

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function toVectorLiteral(values: Embedding) {
  if (
    values.length !== EMBEDDING_DIMENSIONS ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`CLIP must return ${EMBEDDING_DIMENSIONS} finite values`);
  }
  return `[${values.join(",")}]`;
}

function isEmbedding(value: unknown): value is Embedding {
  return Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase function environment is incomplete");
    }
    const token = authorization.slice("Bearer ".length);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) {
      return jsonResponse({ error: "Invalid authentication token" }, 401);
    }

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }
    const input = body as Record<string, unknown>;
    if (
      (input.type !== "lost" && input.type !== "found") ||
      typeof input.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)
    ) {
      return jsonResponse({ error: "Expected a valid item type and UUID" }, 400);
    }
    if (input.image_embedding !== null && !isEmbedding(input.image_embedding)) {
      return jsonResponse({ error: "Invalid image embedding" }, 400);
    }
    if (input.text_embedding !== null && !isEmbedding(input.text_embedding)) {
      return jsonResponse({ error: "Invalid text embedding" }, 400);
    }

    const type = input.type as ItemType;
    const id = input.id;
    const imageVector = input.image_embedding === null
      ? null
      : toVectorLiteral(input.image_embedding as Embedding);
    const textVector = input.text_embedding === null
      ? null
      : toVectorLiteral(input.text_embedding as Embedding);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const table = type === "lost" ? "lost_items" : "found_items";
    const embeddingTable = type === "lost" ? "lost_embeddings" : "found_embeddings";
    const idColumn = type === "lost" ? "lost_id" : "found_id";
    const { data: item, error: itemError } = await admin
      .from(table)
      .select("user_id")
      .eq("id", id)
      .single();
    if (itemError) throw itemError;
    if (item.user_id !== authData.user.id) {
      return jsonResponse({ error: "You do not own this report" }, 403);
    }

    const { data: existing, error: readError } = await admin
      .from(embeddingTable)
      .select("image_embedding, text_embedding")
      .eq(idColumn, id)
      .maybeSingle();
    if (readError) throw readError;

    const { error: upsertError } = await admin.from(embeddingTable).upsert({
      [idColumn]: id,
      image_embedding: imageVector ?? existing?.image_embedding ?? null,
      text_embedding: textVector ?? existing?.text_embedding ?? null,
    });
    if (upsertError) throw upsertError;

    const { error: matchError } = await admin.rpc("refresh_item_matches", {
      p_type: type,
      p_item_id: id,
    });
    if (matchError) throw matchError;

    return jsonResponse({ ok: true, type, id });
  } catch (error) {
    console.error("embed-item failed", error);
    const message = error instanceof Error ? error.message : "Unexpected embedding error";
    return jsonResponse({ error: message }, 500);
  }
});
