# Remotion Development Rules

## Core Principle
Every animation must be a **pure function of frame number**. Given the same frame, render is identical.

## Timing
- `useCurrentFrame()` is the ONLY timing source — never `Date.now()`, `setTimeout`, or CSS transitions
- `interpolate(frame, [inPoint, outPoint], [fromValue, toValue])` for all value transitions
- `spring({ frame, fps, config })` for physics-based motion
- `interpolateColors(frame, [f1, f2], [color1, color2])` for color transitions

## Duration
- `calculateMetadata()` for compositions with dynamic duration
- Never hardcode frame counts derived from runtime data

## Async Assets
- `delayRender()` / `continueRender()` for any async loading (fonts, images, data)
- `staticFile()` for assets in `public/` directory

## Composition Structure
```tsx
export const MyComp: React.FC<Props> = ({ prop1, prop2 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  // ...
};
```

## Anti-Patterns (NEVER DO)
- CSS `transition:` or `animation:` — breaks frame determinism
- `useEffect` with timing logic — side effects don't belong in render
- `Math.random()` without seeding — non-deterministic
- Direct DOM manipulation
- `console.log` in render path (hurts perf at 30fps)

## Performance
- `useMemo` for expensive calculations that don't change every frame
- Avoid re-computing static values inside the render function
- Lazy-load heavy components with `React.lazy` + `delayRender`

## File Structure
```
remotion/
  src/
    compositions/   # Top-level compositions (registered in Root.tsx)
    components/     # Reusable animated components
    hooks/          # Custom Remotion hooks
  public/           # Static assets (videos, images, fonts)
```
