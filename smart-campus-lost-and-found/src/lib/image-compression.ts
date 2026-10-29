export const MAX_COMPRESSED_IMAGE_BYTES = 500 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITIES = [0.82, 0.7, 0.58, 0.46, 0.34, 0.24];

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not compress this image"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

async function smallestBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  let bestBlob: Blob | undefined;
  for (const quality of JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, quality);
    if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
    if (blob.size <= MAX_COMPRESSED_IMAGE_BYTES) return blob;
  }
  if (!bestBlob) throw new Error("The browser could not compress this image");
  return bestBlob;
}

export async function compressImage(file: File): Promise<File> {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  try {
    image.src = objectUrl;
    await image.decode();

    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("The selected image could not be read");
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser cannot compress images");

    let bestBlob: Blob | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      bestBlob = await smallestBlob(canvas);
      if (bestBlob.size <= MAX_COMPRESSED_IMAGE_BYTES || Math.max(canvas.width, canvas.height) <= 640) break;
      canvas.width = Math.max(1, Math.round(canvas.width * 0.8));
      canvas.height = Math.max(1, Math.round(canvas.height * 0.8));
    }

    if (!bestBlob) throw new Error("The browser could not compress this image");
    if (file.size <= MAX_COMPRESSED_IMAGE_BYTES && bestBlob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^/.]+$/, "") || "image";
    return new File([bestBlob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
