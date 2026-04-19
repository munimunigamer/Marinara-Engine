#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# Import Genshin Impact soundtrack into Marinara Engine
# game-assets/music directory with proper categorization.
#
# Categories:
#   combat      — "Battles of" discs + boss/fight themed discs
#   exploration — Overworld region discs (Mondstadt, Liyue, etc.)
#   dialogue    — Character theme albums (Stellar Moments)
#   travel_rest — Voyage/journey discs, gentle travel music
# ─────────────────────────────────────────────────────────
set -euo pipefail

SRC="/Users/marysia/Downloads/genshin-impact-music-collection"
DEST="/Users/marysia/Desktop/Marinara Engine/packages/server/data/game-assets/music"

# Ensure destination directories exist
mkdir -p "$DEST/combat" "$DEST/exploration" "$DEST/dialogue" "$DEST/travel_rest"

# Counters
combat=0 exploration=0 dialogue=0 travel=0 skipped=0

# Convert a filename to a kebab-case slug suitable for music tags.
# Strips track numbers, special chars, collapses whitespace.
slugify() {
  echo "$1" \
    | sed -E 's/\.[^.]+$//' \
    | sed -E 's/^[0-9]+\. ?//' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E "s/[''']//g" \
    | sed -E 's/[^a-z0-9]+/-/g' \
    | sed -E 's/^-+|-+$//g' \
    | cut -c1-80
}

# Copy a file to a category, slugifying the name.
# Usage: copy_to <category> <source_file>
copy_to() {
  local category="$1"
  local src_file="$2"
  local base
  base=$(basename "$src_file")
  local slug
  slug=$(slugify "$base")
  local ext="${base##*.}"
  local dest_file="$DEST/$category/${slug}.${ext}"

  # Skip if already exists
  if [[ -f "$dest_file" ]]; then
    # Add a numeric suffix to avoid collisions
    local i=2
    while [[ -f "$DEST/$category/${slug}-${i}.${ext}" ]]; do
      ((i++))
    done
    dest_file="$DEST/$category/${slug}-${i}.${ext}"
  fi

  cp "$src_file" "$dest_file"
}

echo "Importing Genshin Impact soundtrack..."
echo ""

# ── COMBAT ──
# "Battles of ..." discs, "Roar of the Formidable", boss fight discs
combat_patterns=(
  "Disc 3 - Battles of"
  "Disc 4 - Battles of"
  "Disc 3 - Roar of the Formidable"
  "Disc 3 - A Turbulent Peregrination"
  "Disc 3 - Eternal Antagonism"
  "Disc 4 - La bataille de Fontaine"
  "Disc 3 - Balemoon Rising"
  "Disc 3 - Ad Consummationem"
  "Disc 2 - Galliard of Brass and Iron"
  "05. Vortex of Legends"
)

# ── DIALOGUE (Character themes) ──
dialogue_patterns=(
  "04. The Stellar Moments"
  "08. The Stellar Moments"
  "14. The Stellar Moments"
  "19. The Stellar Moments"
  "07.5. Fleeting Colors in Flight"
  "18.5. La vaguelette"
  "21.5. Emberfire"
)

# ── TRAVEL / REST ──
travel_patterns=(
  "Disc 1 - Fairytales of the Isles"
  "Disc 2 - Fantasia of the Isles"
  "Disc 4 - A Stranger"
  "Disc 1 - A Vagrant Breeze"
  "12. Footprints of the Traveler"
  "16. Footprints of the Traveler"
  "Disc 1 - La liesse"
  "Disc 2 - Tathya"
  "Disc 3 - Anecdotes"
  "Disc 3 - Chapelloise"
  "01. The Wind and The Star Traveler"
)

# Process all mp3 files
find "$SRC" -type f -name "*.mp3" | while IFS= read -r file; do
  category=""

  # Check combat patterns
  for pattern in "${combat_patterns[@]}"; do
    if [[ "$file" == *"$pattern"* ]]; then
      category="combat"
      break
    fi
  done

  # Check dialogue patterns
  if [[ -z "$category" ]]; then
    for pattern in "${dialogue_patterns[@]}"; do
      if [[ "$file" == *"$pattern"* ]]; then
        category="dialogue"
        break
      fi
    done
  fi

  # Check travel patterns
  if [[ -z "$category" ]]; then
    for pattern in "${travel_patterns[@]}"; do
      if [[ "$file" == *"$pattern"* ]]; then
        category="travel_rest"
        break
      fi
    done
  fi

  # Default: exploration (overworld region music)
  if [[ -z "$category" ]]; then
    category="exploration"
  fi

  copy_to "$category" "$file"

  case "$category" in
    combat) ((combat++)) ;;
    exploration) ((exploration++)) ;;
    dialogue) ((dialogue++)) ;;
    travel_rest) ((travel++)) ;;
  esac
done

echo "Done!"
echo ""
echo "  Combat:      $combat tracks"
echo "  Exploration:  $exploration tracks"
echo "  Dialogue:     $dialogue tracks"
echo "  Travel/Rest:  $travel tracks"
echo "  ─────────────────────────"
echo "  Total:        $((combat + exploration + dialogue + travel)) tracks"
echo ""
echo "Run the app and hit the 'Rescan Assets' button, or restart the server."
