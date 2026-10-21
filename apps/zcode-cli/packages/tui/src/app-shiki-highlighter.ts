import path from "node:path";
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
} from "shiki";
import type { TuiThemeMode } from "./theme/index.js";

const SHIKI_DARK_THEME = "github-dark";
const SHIKI_LIGHT_THEME = "github-light";
const SHIKI_THEMES = [SHIKI_DARK_THEME, SHIKI_LIGHT_THEME] as const;
const HIGHLIGHT_TIMEOUT_MS = 2_500;

const LANGUAGE_BY_FILENAME: Record<string, BundledLanguage> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
};

const LANGUAGE_BY_EXTENSION: Record<string, BundledLanguage> = {
  cjs: "javascript",
  cts: "typescript",
  h: "c",
  hpp: "cpp",
  htm: "html",
  mjs: "javascript",
  mts: "typescript",
  psm1: "powershell",
  tsx: "tsx",
  jsx: "jsx",
  swift: "swift",
};

export type ShikiHighlightSegment = {
  color?: string;
  fontStyle?: number;
  text: string;
};

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

let highlighterPromise: Promise<ShikiHighlighter> | undefined;
const loadedLanguages = new Set<BundledLanguage>();
const highlightCache = new Map<string, ShikiHighlightSegment[][] | undefined>();

// 上限来源（2026-10-21 内存泄露调查）：此缓存曾无界且 key 内嵌完整代码内容，长会话中每个
// 渲染过的 diff 代码块永久驻留。上限 + LRU 后驻留体量有界：每条 ≈ 源码 + 分词放大结果，
// 200 条 × 数十 KB ≈ 几 MB 到几十 MB，足以覆盖一屏 diff 的热区。导出供测试断言。
export const SHIKI_HIGHLIGHT_CACHE_LIMIT = 200;

export function inferShikiLanguage(filePath: string | undefined): BundledLanguage | undefined {
  if (!filePath) return undefined;
  const basename = path.basename(filePath).toLowerCase();
  const filenameMatch = LANGUAGE_BY_FILENAME[basename];
  if (filenameMatch) return filenameMatch;

  const extension = path.extname(basename).replace(/^\./u, "");
  if (!extension) return undefined;
  const mapped = LANGUAGE_BY_EXTENSION[extension] ?? extension;
  return isBundledLanguage(mapped) ? mapped : undefined;
}

export async function highlightShikiCodeLines(input: {
  filePath: string | undefined;
  lines: string[];
  mode: TuiThemeMode;
}): Promise<ShikiHighlightSegment[][] | undefined> {
  const language = inferShikiLanguage(input.filePath);
  if (!language) return undefined;

  const theme = shikiThemeForMode(input.mode);
  const cacheKey = `${theme}\0${language}\0${input.lines.join("\n")}`;
  if (highlightCache.has(cacheKey)) {
    const hit = highlightCache.get(cacheKey);
    // LRU touch：delete + set 把命中键挪到 Map 尾部（迭代序 = 插入序），热条目不被挤出。
    highlightCache.delete(cacheKey);
    highlightCache.set(cacheKey, hit);
    return hit;
  }

  const highlighted = await withTimeout(
    tokenizeLines({
      language,
      lines: input.lines,
      theme,
    }),
    HIGHLIGHT_TIMEOUT_MS,
  );
  highlightCache.set(cacheKey, highlighted);
  if (highlightCache.size > SHIKI_HIGHLIGHT_CACHE_LIMIT) {
    // 淘汰队首（最旧插入且未命中刷新的条目）；next().value 在 size > 0 时必为 string。
    const oldestKey = highlightCache.keys().next().value;
    if (oldestKey !== undefined) highlightCache.delete(oldestKey);
  }
  return highlighted;
}

/** 测试专用：当前缓存条目数，验证有界性。 */
export function shikiHighlightCacheSizeForTest(): number {
  return highlightCache.size;
}

export function resetShikiHighlighterForTest(): void {
  highlighterPromise = undefined;
  loadedLanguages.clear();
  highlightCache.clear();
}

async function tokenizeLines(input: {
  language: BundledLanguage;
  lines: string[];
  theme: BundledTheme;
}): Promise<ShikiHighlightSegment[][] | undefined> {
  try {
    const highlighter = await getHighlighter();
    if (!loadedLanguages.has(input.language)) {
      await highlighter.loadLanguage(input.language);
      loadedLanguages.add(input.language);
    }

    const result = highlighter.codeToTokens(input.lines.join("\n"), {
      lang: input.language,
      theme: input.theme,
    });
    return padTokenLines(
      result.tokens.map((line) =>
        line.map((token) => ({
          color: token.color,
          fontStyle: token.fontStyle,
          text: token.content,
        })),
      ),
      input.lines.length,
    );
  } catch {
    return undefined;
  }
}

function getHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= createHighlighter({
    langs: [],
    themes: [...SHIKI_THEMES],
  });
  return highlighterPromise;
}

function isBundledLanguage(language: string): language is BundledLanguage {
  return Object.prototype.hasOwnProperty.call(bundledLanguages, language);
}

function shikiThemeForMode(mode: TuiThemeMode): BundledTheme {
  return mode === "light" ? SHIKI_LIGHT_THEME : SHIKI_DARK_THEME;
}

function padTokenLines(
  lines: ShikiHighlightSegment[][],
  expectedLength: number,
): ShikiHighlightSegment[][] {
  if (lines.length >= expectedLength) return lines.slice(0, expectedLength);
  return [...lines, ...Array.from({ length: expectedLength - lines.length }, () => [])];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
