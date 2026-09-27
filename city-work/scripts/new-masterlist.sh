#!/usr/bin/env bash
set -e
SLUG="$1"
BRAND="$2"
[ -z "$SLUG" ] && { echo "usage: $0 <slug> <Brand>"; exit 1; }
DIR="app/${SLUG}-masterlist"
SOURCE="app/bravo-masterlist"
mkdir -p "$DIR"
cp "$SOURCE/masterlist.css" "$DIR/${SLUG}.css"
sed \
  -e "s|bravo_masterlist|${SLUG}_masterlist|g" \
  -e "s|bravo_prioritization|${SLUG}_prioritization|g" \
  -e "s|bravo_date_notes|${SLUG}_date_notes|g" \
  -e "s|BravoMasterlistPage|BrandMasterlistPage|g" \
  -e "s|BRAVO|BRANDNAME|g" \
  -e "s|import './masterlist.css'|import './${SLUG}.css'|" \
  "$SOURCE/page.tsx" > "$DIR/page.tsx"
python3 - "$DIR/page.tsx" "$BRAND" << 'PYEOF'
import sys
p, brand = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
s = s.replace('BRANDNAME', brand)
s = s.replace('Executive Lounge', f'{brand} Masterlist')
open(p, 'w', encoding='utf-8').write(s)
print(f'  ✓ {p}')
PYEOF
echo "  → route: /${SLUG}-masterlist"
