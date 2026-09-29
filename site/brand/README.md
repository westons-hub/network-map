# Orbit — web brand kit

## Copy
- Name: Orbit
- Headline: Welcome
- Tagline: Your orbit, always moving outward.

## Files
- orbit-logo.svg / orbit-logo-white.svg — horizontal logo (mark + wordmark). Text is outlined, no font needed. Use white on dark backgrounds.
- orbit-mark.svg / orbit-mark-white.svg — symbol only (avatars, app icon, small spaces)
- favicon.svg, favicon-32.png, favicon-16.png — browser tab icon (heavier strokes for small sizes)
- apple-touch-icon.png — 180×180 iOS home-screen icon (white background, as iOS expects)
- *-512.png, *-4x.png — transparent PNGs for places that don't take SVG
- brand.css — colors + font as CSS variables

All logos have transparent backgrounds.

## Head snippet
```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/brand.css">
```

## Logo in the header
```html
<a href="/"><img src="/orbit-logo.svg" alt="Orbit" height="40"></a>
```

## Colors
Navy #1E3A5F · Orange #F97316 · Rose #F43F5E · Slate #5B6B80 · Light bg #F5F6F8 · Dark bg #131A26
Font: DM Sans (700 headings, 400 body)
