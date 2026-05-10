# BirGap UI Lab — Plan & Log

## Project Structure
```
ui-lab/
├── shared/              # Shared fetch client + TypeScript types
├── v1-console/          # Terminal retro console
├── v2-glass/            # Glassmorphism modern
├── v3-mobile/           # Mobile phone frame
├── v4-dashboard/        # Power-user dashboard
└── docs/
    ├── LAB-PLAN.md      # This file
    ├── INTEGRATION.md   # Errors & integration notes
    └── API-SURFACE.md   # Backend API reference
```

## Shared Layer (shared/)
- `api.ts` — Fetch-based API client wrapping all BirGap endpoints
- `types.ts` — TypeScript interfaces mirroring all backend DTOs/models

## Version Plans

### v1-console — "Retro Console"
- **Aesthetic**: Black background, green monospace text, CRT scanline effect
- **Layout**: Full-screen terminal, chat in center, sidebar for contacts/devices
- **Features**: OTP login, send/receive messages, WebSocket real-time
- **Tech**: Vite + React 18, CSS only animations, no extra UI libs
- **Theme colors**: #00ff41 (matrix green), #00d4ff (cyan accents), #111111 (bg)

### v2-glass — "Glass Chamber"
- **Aesthetic**: Glassmorphism (frosted glass cards on gradient backgrounds)
- **Layout**: Centered chat window with floating glass panels
- **Features**: Smooth animations, gradient orbs, blur effects, dark/light mode
- **Tech**: Vite + React 18, Tailwind CSS, CSS backdrop-filter
- **Theme colors**: rgba(255,255,255,0.1) glass, purple-blue gradient bg

### v3-mobile — "Pocket Messenger"
- **Aesthetic**: Mobile-first, rendered inside a phone frame
- **Layout**: Bottom tab bar, message bubbles, swipe actions
- **Features**: Touch-optimized, pull-to-refresh, mobile nav patterns
- **Tech**: Vite + React 18, styled-components, mobile viewport (390x844)
- **Theme colors**: Clean white/iOS style, blue accent (#007AFF)

### v4-dashboard — "Signal Station"
- **Aesthetic**: Power-user dashboard with data density
- **Layout**: Multi-panel split view: devices | chat | network | diagnostics
- **Features**: Keyboard shortcuts, real-time metrics, device management, prekey status
- **Tech**: Vite + React 18, Tailwind CSS, raw CSS Grid
- **Theme colors**: Dark slate (#0f172a), electric blue (#3b82f6), emerald (#10b981)

## Development Order
1. Shared API client + types
2. v1-console (simplest, establishes patterns)
3. v2-glass
4. v3-mobile
5. v4-dashboard
6. Integration docs + error log

## Status
- [x] API surface documented (API-SURFACE.md)
- [x] Shared API client created
- [x] Shared types created
- [ ] v1-console
- [ ] v2-glass
- [ ] v3-mobile
- [ ] v4-dashboard
- [ ] INTEGRATION.md