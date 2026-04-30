# Art prompts — gpt-image-1 + Pollinations

Use the OpenAI key in `reference_creative_api_keys.md` (or fall back to
`https://image.pollinations.ai/prompt/...` for free unlimited gen). Save
outputs to `marketing/art/` (created on first run).

## Brawler PFPs (24 batch)

```
Pixel art, 24x32 sprite style, single brawler portrait, three-quarter view,
chunky pixel outline, dark purple background (#4A2C7A), holding a [WEAPON],
wearing [OUTFIT], expression [EXPRESSION], game asset for "BASEic Brawlers"
on-chain game. NO text, NO watermark, NO logo, NO modern clothing.
```

Variants — fill in:
- WEAPON: baseball bat / axe / sword / hammer / spear / bow / dagger / staff
- OUTFIT: tattered cloak / leather armor / mage robes / ranger's hood / barbarian fur / ninja garb
- EXPRESSION: scowling / smirking / wide-eyed / battle-roar / cold-stare

Generate 4 variants each → 24 PFPs total. Pick best 10 for X posting.

## Banner — group cover (1500x500)

```
Wide pixel-art landscape banner, 1500x500, fight-arena perspective from
ringside, multiple chunky pixel-art brawlers (24x32 sprites) facing off
under a giant glowing CROWN floating above the arena. Dark purple stage
background (#4A2C7A) with neon-orange torches (#f5a623) at the corners.
Crowd silhouettes in the back row. NO text, NO logo, NO watermark.
```

## Banner — X header (1500x500)

```
Wide pixel-art header, 1500x500, "BASEic BRAWLERS" theme, single hero
brawler in centre raising a bloodied baseball bat, smaller silhouettes of
fallen brawlers in the foreground, dark-purple-to-blood-red gradient sky,
glowing crown emblem in top-right corner. NO text overlay (keep clean),
NO watermark.
```

## Launch-day announce graphic (1080x1080)

```
Square pixel-art announce graphic, 1080x1080, three brawlers in a triangle
composition (one with axe, one with sword, one with mage staff), dark
purple background (#4A2C7A) with dramatic side-lighting from torches in
the corners, large glowing CROWN at the top centre. Empty banner space at
the bottom 25% of the image (will be overlaid with launch text in post).
NO text or watermark in the image.
```

## Death / graveyard (square, 1080x1080)

```
Square pixel-art memorial graphic, 1080x1080, single defeated brawler
slumped at the base of a tombstone, candle flickering beside, dark-purple
background fading to black at the edges (#1a1417 vignette), pixel-art
crows perched on the tombstone. Empty banner space at the bottom 25% of
the image. Quiet, somber mood. NO text overlay or watermark.
```

## "Founder" celebration (square, 1080x1080)

```
Square pixel-art celebration graphic, 1080x1080, single brawler holding up
a glowing gold star badge labelled "FOUNDER" (badge can have text — that's
the only text allowed), surrounded by floating coins and confetti pixels,
dark purple stage background with gold spotlight from above. Triumphant
pose. NO other text or watermark beyond the badge.
```

## Kling video animations (fal.ai)

For short Telegram/X video clips. Image-to-video with one of the brawler
PFPs above as the seed frame.

```
Source image: [path to brawler PFP]
Prompt: "The brawler turns toward the camera, raises their weapon overhead,
and lets out a battle cry. Pixel-art style is preserved. Dark purple
background stays static. 4-second loop."
Duration: 4
Model: kling-master-1.5 (or whatever is current on fal.ai)
```

## Generation script (one-shot)

Save this as `marketing/art/gen.sh` and adjust counts:

```bash
#!/usr/bin/env bash
# Generate brawler PFPs in batch using Pollinations (free, no key).
# Falls back to OpenAI if you set OPENAI_API_KEY for higher quality.
set -e
mkdir -p marketing/art

WEAPONS=("baseball bat" "battleaxe" "longsword" "war hammer" "spear" "bow")
OUTFITS=("tattered cloak" "leather armor" "mage robes" "ranger hood" "barbarian fur")
EXPRESSIONS=("scowling" "smirking" "battle-roar" "cold stare")

i=1
for weapon in "${WEAPONS[@]}"; do
  for outfit in "${OUTFITS[@]}"; do
    expr="${EXPRESSIONS[$((i % 4))]}"
    prompt="Pixel art 24x32 sprite, single brawler, three-quarter view, chunky pixel outline, dark purple background (#4A2C7A), holding a ${weapon}, wearing ${outfit}, ${expr}, game asset, no text, no watermark"
    encoded=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$prompt")
    out="marketing/art/brawler_${i}.png"
    curl -sL "https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&nologo=true" -o "$out"
    echo "saved $out"
    i=$((i+1))
  done
done
```
