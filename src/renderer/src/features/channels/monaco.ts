// Loaded only when a code channel opens: the full Monaco build with the TypeScript,
// JSON, CSS and HTML language services, each in its own worker.
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

/** Follows the app theme: the editor background is the app's deepest surface. */
export function editorTheme(): string {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-deep").trim() || "#0e0d16";
  const [r = 0, g = 0, b = 0] = (bg.match(/[0-9a-f]{2}/gi) ?? []).map((h) => parseInt(h, 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 140;
  const name = light ? "annoy-light" : "annoy-dark";
  monaco.editor.defineTheme(name, { base: light ? "vs" : "vs-dark", inherit: true, rules: [], colors: { "editor.background": bg, "editorGutter.background": bg } });
  return name;
}

/** Monaco's language id for a file name, from the languages it knows. */
export function languageOf(path: string): string {
  const name = path.split("/").pop()!.toLowerCase();
  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((f) => f.toLowerCase() === name)) return language.id;
    if (language.extensions?.some((ext) => name.endsWith(ext.toLowerCase()))) return language.id;
  }
  return "plaintext";
}

export { monaco };
