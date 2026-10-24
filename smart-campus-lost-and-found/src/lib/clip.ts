import {
  AutoProcessor,
  AutoTokenizer,
  CLIPModel,
  RawImage,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";
export const CLIP_EMBEDDING_DIMENSIONS = 512;

type ClipModel = Awaited<ReturnType<typeof CLIPModel.from_pretrained>>;
type ClipProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type ClipTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;

let resourcesPromise: Promise<{
  model: ClipModel;
  processor: ClipProcessor;
  tokenizer: ClipTokenizer;
}> | null = null;

function loadResources() {
  resourcesPromise ??= Promise.all([
    CLIPModel.from_pretrained(MODEL_ID),
    AutoProcessor.from_pretrained(MODEL_ID),
    AutoTokenizer.from_pretrained(MODEL_ID),
  ]).then(([model, processor, tokenizer]) => ({ model, processor, tokenizer }));
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
  const [{ model, processor }] = await Promise.all([loadResources()]);
  const image = await RawImage.fromBlob(file);
  const inputs = await processor(image);
  const output = await model({ ...inputs });
  return normalize(output.image_embeds.data);
}

export async function textEmbedding(text: string) {
  const [{ model, tokenizer }] = await Promise.all([loadResources()]);
  const inputs = tokenizer([text.trim()], { padding: true, truncation: true });
  const output = await model({ ...inputs });
  return normalize(output.text_embeds.data);
}
