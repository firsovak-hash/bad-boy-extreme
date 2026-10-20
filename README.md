# Bad Boy Extreme — scroll experience

A scroll-driven 3D product page concept: a hand-built model of the Bad Boy Extreme 50 ml bottle
(Blender, built from measurements) rendered in the browser with three.js and choreographed with
GSAP ScrollTrigger — monogram intro, desert and storm backgrounds, the lightning-bolt turn, the
press of the cap key, and a black final block.

**Concept by FIRSOV. Not affiliated with, or endorsed by, Carolina Herrera.** Brand names and the
CH monogram belong to their owners; this is a non-commercial portfolio piece.

## Run locally

```bash
python3 -m http.server 5173
```

then open http://localhost:5173. Any static host works (Netlify, Vercel, GitHub Pages).

## Stack

- three.js r160: custom shaders (sprayed black-to-gold gradient with metallic flakes, lacquer,
  skin from photo-derived maps), video backgrounds
- GSAP 3.12 + ScrollTrigger
- Models exported from Blender as glTF
