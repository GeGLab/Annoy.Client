/** Blob URLs belong to the app's renderer and cannot be opened by an external browser. */
export async function openOriginalImage(url: string, filename: string): Promise<void> {
  if (!/^(blob|data):/.test(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const child = window.open("about:blank", `annoy-image:${crypto.randomUUID()}`, "width=1100,height=800");
  if (!child) throw new Error("Image window was blocked");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Image could not be loaded");
    const blob = await response.blob();
    if (child.closed) return;
    // The child owns its URL, so closing the preview does not revoke the original.
    const childURL = (child as Window & typeof globalThis).URL;
    const source = childURL.createObjectURL(blob);
    const doc = child.document;
    doc.title = filename;
    doc.body.style.cssText = "margin:0;background:#171621;display:grid;min-height:100vh;place-items:center";
    const image = doc.createElement("img");
    image.alt = filename;
    image.src = source;
    image.style.cssText = "display:block";
    doc.body.append(image);
    child.addEventListener("pagehide", () => childURL.revokeObjectURL(source), { once: true });
  } catch (error) {
    child.close();
    throw error;
  }
}
