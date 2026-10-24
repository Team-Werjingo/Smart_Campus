import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const IMAGE_BUCKET = "report-images";
const EMBEDDING_DIMENSIONS = 768;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function toVectorLiteral(values: Embedding) {
  if (
    values.length !== EMBEDDING_DIMENSIONS ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`SigLIP service must return ${EMBEDDING_DIMENSIONS} finite values`);
  }
  return `[${values.join(",")}]`;
}

function isEmbedding(value: unknown): value is Embedding {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

async function embed(
  modality: "text" | "image",
  content: string,
  contentType?: string,
): Promise<Embedding> {
  const endpoint = requiredEnv("SIGLIP_EMBEDDING_URL").replace(/\/+$/, "");
  const token = requiredEnv("SIGLIP_SERVICE_TOKEN");
  const payload = modality === "text"
    ? { modality, text: content }
    : { modality, image_base64: content, content_type: contentType };

  const response = await fetch(`${endpoint}/embed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`SigLIP service returned ${response.status}: ${detail}`);
  }

  const result: { embedding?: unknown } = await response.json();
  if (!isEmbedding(result.embedding)) {
    throw new Error("SigLIP service returned an invalid embedding");
  }
  toVectorLiteral(result.embedding);
  return result.embedding;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
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
    if (
      typeof body !== "object" ||
      body === null ||
      !("type" in body) ||
      !("id" in body) ||
      (body.type !== "lost" && body.type !== "found") ||
      typeof body.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)
    ) {
      return jsonResponse({ error: "Expected a valid item type and UUID" }, 400);
    }

    const type: ItemType = body.type;
    const id = body.id;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let photoPath: string | null;
    let description: string | null = null;
    if (type === "lost") {
      const { data, error } = await admin
        .from("lost_items")
        .select("user_id, description, photo_path")
        .eq("id", id)
        .single();
      if (error) throw error;
      if (data.user_id !== authData.user.id) {
        return jsonResponse({ error: "You do not own this report" }, 403);
      }
      description = data.description;
      photoPath = data.photo_path;
    } else {
      const { data, error } = await admin
        .from("found_items")
        .select("user_id, photo_path")
        .eq("id", id)
        .single();
      if (error) throw error;
      if (data.user_id !== authData.user.id) {
        return jsonResponse({ error: "You do not own this report" }, 403);
      }
      photoPath = data.photo_path;
    }

    let imageVector: string | null = null;
    if (photoPath) {
      const { data: image, error } = await admin.storage.from(IMAGE_BUCKET).download(photoPath);
      if (error) throw error;
      if (image.size > MAX_IMAGE_BYTES) {
        throw new Error("Image exceeds the 10 MB embedding limit");
      }
      const imageBytes = new Uint8Array(await image.arrayBuffer());
      imageVector = toVectorLiteral(
        await embed("image", bytesToBase64(imageBytes), image.type || "image/jpeg"),
      );
    } else if (type === "found") {
      throw new Error("Found item photo is missing");
    }

    let textVector: string | null = null;
    if (type === "lost") {
      if (!description?.trim()) throw new Error("Lost item description is missing");
      textVector = toVectorLiteral(await embed("text", description.trim()));
    }

    if (type === "lost") {
      const { data: existing, error: readError } = await admin
        .from("lost_embeddings")
        .select("image_embedding, text_embedding")
        .eq("lost_id", id)
        .maybeSingle();
      if (readError) throw readError;
      const { error } = await admin.from("lost_embeddings").upsert({
        lost_id: id,
        image_embedding: imageVector ?? existing?.image_embedding ?? null,
        text_embedding: textVector ?? existing?.text_embedding,
      });
      if (error) throw error;
    } else {
      const { data: existing, error: readError } = await admin
        .from("found_embeddings")
        .select("image_embedding, text_embedding")
        .eq("found_id", id)
        .maybeSingle();
      if (readError) throw readError;
      const { error } = await admin.from("found_embeddings").upsert({
        found_id: id,
        image_embedding: imageVector ?? existing?.image_embedding,
        text_embedding: existing?.text_embedding ?? null,
      });
      if (error) throw error;
    }

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
