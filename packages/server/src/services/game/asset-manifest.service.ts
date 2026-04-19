// ──────────────────────────────────────────────
// Game: Asset Manifest Scanner
//
// Scans the game-assets directory tree and builds
// a tag → path manifest. Re-scans on demand or
// after uploads.
// ──────────────────────────────────────────────
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, extname, relative, basename } from "path";
import { DATA_DIR } from "../../utils/data-dir.js";

export const GAME_ASSETS_DIR = join(DATA_DIR, "game-assets");
const USER_BACKGROUNDS_DIR = join(DATA_DIR, "backgrounds");
const MANIFEST_PATH = join(GAME_ASSETS_DIR, "manifest.json");

/** Supported file extensions by asset category. */
const EXTENSIONS: Record<string, Set<string>> = {
  music: new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".webm"]),
  sfx: new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".webm"]),
  ambient: new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".webm"]),
  sprites: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]),
  backgrounds: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]),
};

/** A single entry in the asset manifest. */
export interface AssetEntry {
  /** Tag for referencing in prompts, e.g. "music:combat:epic-battle" */
  tag: string;
  /** Category: music, sfx, sprites, backgrounds */
  category: string;
  /** Sub-category, e.g. "combat", "exploration", "generic-fantasy" */
  subcategory: string;
  /** Filename without extension */
  name: string;
  /** Relative path from game-assets root */
  path: string;
  /** File extension */
  ext: string;
}

export interface AssetManifest {
  /** ISO timestamp of last scan */
  scannedAt: string;
  /** Total asset count */
  count: number;
  /** All assets indexed by tag */
  assets: Record<string, AssetEntry>;
  /** Assets grouped by category for quick listing */
  byCategory: Record<string, AssetEntry[]>;
}

/** Ensure the base game-assets directory structure exists. */
export function ensureAssetDirs(): void {
  const dirs = [
    GAME_ASSETS_DIR,
    join(GAME_ASSETS_DIR, "music", "exploration"),
    join(GAME_ASSETS_DIR, "music", "combat"),
    join(GAME_ASSETS_DIR, "music", "dialogue"),
    join(GAME_ASSETS_DIR, "music", "travel_rest"),
    join(GAME_ASSETS_DIR, "sfx", "ui"),
    join(GAME_ASSETS_DIR, "sfx", "combat"),
    join(GAME_ASSETS_DIR, "sfx", "exploration"),
    join(GAME_ASSETS_DIR, "ambient", "nature"),
    join(GAME_ASSETS_DIR, "ambient", "urban"),
    join(GAME_ASSETS_DIR, "ambient", "interior"),
    join(GAME_ASSETS_DIR, "sprites", "generic-fantasy"),
    join(GAME_ASSETS_DIR, "sprites", "generic-scifi"),
    join(GAME_ASSETS_DIR, "backgrounds", "fantasy"),
    join(GAME_ASSETS_DIR, "backgrounds", "scifi"),
    join(GAME_ASSETS_DIR, "backgrounds", "modern"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** Recursively scan a directory for files matching the given extensions. */
function scanDir(dir: string, allowedExts: Set<string>): Array<{ rel: string; name: string; ext: string }> {
  const results: Array<{ rel: string; name: string; ext: string }> = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue; // skip hidden files
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Recurse into subdirectories
      const sub = scanDir(full, allowedExts);
      results.push(...sub);
    } else {
      const ext = extname(entry).toLowerCase();
      if (allowedExts.has(ext)) {
        const rel = relative(GAME_ASSETS_DIR, full).replace(/\\/g, "/");
        const name = basename(entry, ext);
        results.push({ rel, name, ext });
      }
    }
  }
  return results;
}

/**
 * Build a tag from a relative path.
 * e.g. "music/combat/epic-battle.mp3" → "music:combat:epic-battle"
 */
function pathToTag(rel: string): string {
  const withoutExt = rel.replace(/\.[^.]+$/, "");
  return withoutExt.replace(/\//g, ":");
}

/** Extract category and subcategory from relative path. */
function parsePathParts(rel: string): { category: string; subcategory: string } {
  const parts = rel.split("/");
  return {
    category: parts[0] ?? "unknown",
    subcategory: parts[1] ?? "default",
  };
}

/** Scan the entire game-assets tree and build the manifest. */
export function buildAssetManifest(): AssetManifest {
  ensureAssetDirs();

  const assets: Record<string, AssetEntry> = {};
  const byCategory: Record<string, AssetEntry[]> = {};

  for (const [category, exts] of Object.entries(EXTENSIONS)) {
    const categoryDir = join(GAME_ASSETS_DIR, category);
    const files = scanDir(categoryDir, exts);

    if (!byCategory[category]) byCategory[category] = [];

    for (const file of files) {
      const tag = pathToTag(file.rel);
      const { subcategory } = parsePathParts(file.rel);
      const entry: AssetEntry = {
        tag,
        category,
        subcategory,
        name: file.name,
        path: file.rel,
        ext: file.ext,
      };
      assets[tag] = entry;
      byCategory[category]!.push(entry);
    }
  }

  // Also scan user-uploaded backgrounds from data/backgrounds/
  const userBgFiles = scanDir(USER_BACKGROUNDS_DIR, EXTENSIONS.backgrounds!);
  if (!byCategory.backgrounds) byCategory.backgrounds = [];
  for (const file of userBgFiles) {
    // Tag format: "backgrounds:user:<filename>" — path is relative to GAME_ASSETS_DIR
    // but served via /api/backgrounds/<filename> so we store a special marker
    const tag = `backgrounds:user:${file.name}`;
    if (assets[tag]) continue; // skip if already exists
    const entry: AssetEntry = {
      tag,
      category: "backgrounds",
      subcategory: "user",
      name: file.name,
      path: `__user_bg__/${file.name}${file.ext}`,
      ext: file.ext,
    };
    assets[tag] = entry;
    byCategory.backgrounds.push(entry);
  }

  const manifest: AssetManifest = {
    scannedAt: new Date().toISOString(),
    count: Object.keys(assets).length,
    assets,
    byCategory,
  };

  // Persist to disk for quick reload
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");

  return manifest;
}

/** Load manifest from cache or scan if missing. */
export function getAssetManifest(): AssetManifest {
  if (existsSync(MANIFEST_PATH)) {
    try {
      return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    } catch {
      // Corrupt file — rebuild
    }
  }
  return buildAssetManifest();
}

/**
 * Build a condensed asset list string for injection into GM prompts.
 * Only includes tags, grouped by category.
 */
export function buildAssetTagList(): string {
  const manifest = getAssetManifest();
  if (manifest.count === 0) return "";

  const sections: string[] = [];
  for (const [category, entries] of Object.entries(manifest.byCategory)) {
    if (entries.length === 0) continue;
    const tags = entries.map((e) => e.tag).join(", ");
    sections.push(`${category}: [${tags}]`);
  }

  return sections.join("\n");
}
