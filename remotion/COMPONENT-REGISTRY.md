# EDDIE Remotion Component Registry

> Plan 5 — Component Library + Visual Quality Upgrade
> Updated: 2026-02-28

---

## Constants (`remotion/src/constants/`)

| File | Exports | Purpose |
|------|---------|---------|
| `colors.ts` | `COLORS`, `ColorKey` | Brand palette + semantic colors + backgrounds |
| `springs.ts` | `SPRING_PRESETS`, `SpringPreset` | smooth / snappy / bouncy / heavy / gentle |
| `typography.ts` | `TYPOGRAPHY`, `TypographyVariant`, `MIN_FONT_SIZES` | Hero/title/body/code/label/closing/caption variants |
| `timing.ts` | `FPS`, `WIDTH`, `HEIGHT`, `seconds()`, `FADES`, `SAFE_ZONES`, `CLOSING`, `STAGGER` | Global timing constants |
| `index.ts` | re-exports all | Barrel import |

---

## Core Components

### `AnimatedText`
Word-by-word spring animation with idle oscillation.

```tsx
<AnimatedText
  text="Hello world"
  delay={4}
  color="#FFFFFF"
  fontSize={72}
  fontWeight={800}
  fontFamily={fontFamily}
  variant="hero"           // optional: overrides fontSize/fontWeight from TYPOGRAPHY
  entrance="slideUp"       // slideUp | slideDown | scale | fade | none
  springPreset="gentle"    // smooth | bouncy | snappy | heavy | gentle
  staggerFrames={2}
  enableIdle={true}
/>
```

Used by: HookSection, ForeshadowSection, BodySection (NewsShort)

---

### `SceneContainer`
AbsoluteFill wrapper with background + safe margins + fade.

```tsx
<SceneContainer
  background="dark"        // dark | surface | warm | cosmic | light | hex
  safeMargin="recommended" // none | minimum | recommended
  fadeIn={12}
  fadeOut={12}
>
  {children}
</SceneContainer>
```

---

## Effect Components

### `BlurText`
Word-by-word (or letter-by-letter) blur+translate reveal.

```tsx
<BlurText
  text="The machines won"
  startFrame={10}
  animateBy="words"        // words | letters
  direction="bottom"       // top | bottom | left | right
  staggerDelay={4}
  blurAmount={8}
  distance={20}
  fontSize={44}
  fontWeight={600}
  color="#FFFFFF"
/>
```

Used by: ClosingScene

---

### `GlitchText`
Chromatic aberration — 3-layer RGB split with noise2D offsets and scan-line clipPath cycling.

```tsx
<GlitchText
  text="nervous"
  startFrame={4}
  intensity={0.5}          // 0–1
  speed={1}
  enableShadows={true}
  fontSize={72}
  fontWeight={800}
  color="#FFFFFF"
/>
```

Used by: HookSection (when emphasisWord set)

---

### `GlitchBurst`
Periodic glitch burst wrapper — wraps any children with noise-driven shake + opacity pulse.

```tsx
<GlitchBurst burstInterval={60} burstDuration={6} intensity={0.7}>
  <SomeComponent />
</GlitchBurst>
```

---

### `CountUp`
Animated number counter with spring or linear easing.

```tsx
<CountUp
  to={500}
  from={0}
  startFrame={15}
  prefix="$"
  suffix="M"
  separator=","
  decimals={0}
  useSpring={true}
  color={COLORS.eddieCyan}
  fontSize={80}
  fontWeight={800}
/>
```

### `CountUpWithLabel`
Wraps `CountUp` with a positioned label.

```tsx
<CountUpWithLabel
  to={500}
  prefix="$"
  suffix="M"
  label="hedge fund closed"
  labelPosition="bottom"
  labelColor="rgba(255,255,255,0.6)"
  labelFontSize={32}
  color={COLORS.eddieCyan}
  fontSize={80}
/>
```

Used by: BodySection when `componentHint === 'countup'`

---

### `ShinyText`
Animated gradient shine sweep via background-clip:text.

```tsx
<ShinyText
  text="everything"
  startFrame={4}
  color="rgba(255,255,255,0.9)"
  shineColor="rgba(255,255,255,0.85)"
  duration={45}
  pauseDuration={60}
  direction="right"
  fontSize={58}
  fontWeight={600}
/>
```

Used by: ForeshadowSection (when emphasisWord set)

---

## Layout Components

### `BackgroundLayer`
Noise2D animated orbs, section-reactive glows, drifting grid.

```tsx
<BackgroundLayer sections={sections} colorPalette={palette} />
```

---

### `MidgroundLayer`
Scan line, accent lines, data orbs.

```tsx
<MidgroundLayer sections={sections} colorPalette={palette} />
```

---

### `StatusBar`
Top-of-screen status bar with source label and pulsing dot.

```tsx
<StatusBar source="Reuters" color="#00D4FF" />
```

---

### `NotificationFrame`
Full-frame border overlay with emotion badge.

```tsx
<NotificationFrame
  emotion="WTF"
  showBadge={true}
  accentColor="#00D4FF"
>
  {children}
</NotificationFrame>
```

---

### `DataBadge`
Floating data badge overlay.

```tsx
<DataBadge value="$500M" label="hedge fund losses" />
```

---

### `TerminalDot`
Animated terminal cursor dot.

---

### `ClosingScene`
**Channel signature closing.** BlurText reveal → accent line with radial glow → hold.

```tsx
<ClosingScene
  lines={["The machines already won.", "E.D.D.I.E."]}
  accentLineIndex={1}
  accentColor={COLORS.insightOrange}
/>
```

- Dynamic timing based on `durationInFrames`:
  - ≤15s: breathing=10f, lines spaced 60f
  - 15-25s: breathing=15f
  - >25s: breathing=20f
- "E.D.D.I.E." pattern auto-detected and styled as accent
- Radial glow behind accent line

Used by: NewsShort (replaces PayoffSection), RankingShort (replaces OutroCard)

---

## Overlay Components

### `CaptionOverlay`
TikTok-style word-highlighted captions using `@remotion/captions`.

```tsx
<CaptionOverlay
  captions={captions}        // Caption[] from @remotion/captions
  accentColor={COLORS.insightOrange}
/>
```

- Active word: accentColor + scale(1.15) + glow shadow
- Position: bottom of screen above safe zone

**Caption format** (from pipeline adapter `toRemotionCaptions()`):
```ts
{ text, startMs, endMs, timestampMs, confidence }
```

---

## Compositions

### `NewsShort`
Main news short format. Schema:
```ts
{
  hook, foreshadow, body[], payoff, title, source,
  emotionTarget?,
  captions?,          // Caption[] from @remotion/captions
  spec?,              // AnimationSpec (from spec-generator)
  dataBadges?,        // DataBadgeData[]
  closingLines?,      // string[] (from spec.closing.lines)
  closingAccentIndex? // number
}
```

Section pipeline:
1. HookSection (NotificationFrame + GlitchText on emphasisWord)
2. ForeshadowSection (ShinyText on emphasisWord)
3. BodySection × N (CountUpWithLabel when componentHint='countup')
4. ClosingScene (replaces PayoffSection)

### `RankingShort`
Ranking format. TitleCard → RankItem × N → ClosingScene (E.D.D.I.E. signature).

---

## Spec Pipeline

`generateAnimationSpec(script, style)` in `src/video/spec-generator.ts` produces:
- **ComponentHints**: hook→glitch, foreshadow→shiny, body (with number)→countup
- **EmphasisWords**: last significant word for hook; middle significant word for foreshadow
- **IntraBeats**: 8-12 sub-beats per section
- **ClosingSpec**: `{ lines: [payoff, 'E.D.D.I.E.'], accentLineIndex: 1, holdFrames: 60 }`
- **CLOSING_BUFFER**: +100 frames added to payoff section and total duration

Caption adapter in `pipeline.ts`:
```ts
toRemotionCaptions(raw) // {startInSeconds,endInSeconds} → {startMs,endMs,timestampMs,confidence}
```
