import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";
export const CLIP_EMBEDDING_DIMENSIONS = 512;

type ClipTextModel = Awaited<ReturnType<typeof CLIPTextModelWithProjection.from_pretrained>>;
type ClipVisionModel = Awaited<ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>>;
type ClipProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type ClipTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;

let resourcesPromise: Promise<{
  textModel: ClipTextModel;
  visionModel: ClipVisionModel;
  processor: ClipProcessor;
  tokenizer: ClipTokenizer;
}> | null = null;

function loadResources() {
  resourcesPromise ??= Promise.all([
    CLIPTextModelWithProjection.from_pretrained(MODEL_ID),
    CLIPVisionModelWithProjection.from_pretrained(MODEL_ID),
    AutoProcessor.from_pretrained(MODEL_ID),
    AutoTokenizer.from_pretrained(MODEL_ID),
  ]).then(([textModel, visionModel, processor, tokenizer]) => ({
    textModel,
    visionModel,
    processor,
    tokenizer,
  }));
  return resourcesPromise;
}

function normalize(values: ArrayLike<number>) {
  let magnitude = 0;
  for (let index = 0; index < values.length; index += 1) {
    magnitude += values[index] ** 2;
  }
  magnitude = Math.sqrt(magnitude);
  if (!magnitude || values.length !== CLIP_EMBEDDING_DIMENSIONS) {
    throw new Error("CLIP returned an invalid embedding");
  }
  return Array.from(values, (value) => value / magnitude);
}

export async function imageEmbedding(file: File) {
  const { visionModel, processor } = await loadResources();
  const image = await RawImage.fromBlob(file);
  const inputs = await processor(image);
  const output = await visionModel(inputs);
  return normalize(output.image_embeds.data);
}

export async function textEmbedding(text: string) {
  const { textModel, tokenizer } = await loadResources();
  const inputs = tokenizer([text.trim()], { padding: true, truncation: true });
  const output = await textModel(inputs);
  return normalize(output.text_embeds.data);
}
