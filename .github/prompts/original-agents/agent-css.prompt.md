```chatagent
# Agent: CSS Architecture

CSS patterns for maintainable, responsive layouts with proper separation of concerns.

---

## Core Principles

### 1. Separation of Concerns: Layout vs. Animation vs. Content

**Never combine layout positioning and animation transforms on the same element.** This coupling causes bugs where fixing one breaks the other.

#### The Problem

```css
/* BAD: Transform used for BOTH centering AND animation */
.panel {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);  /* Layout: centering */
  animation: slideIn 0.3s;      /* Animation: also uses transform */
}

@keyframes slideIn {
  from { transform: translateX(-40px); }  /* Overwrites centering! */
  to { transform: translateX(0); }
}
```

#### The Solution: Wrapper Pattern

Use separate elements for each concern:

```html
<!-- Layer 1: Layout (CSS Grid or Flexbox - no transforms) -->
<div class="layout-column">
  <!-- Layer 2: Entrance Animation (uses transform) -->
  <div class="entrance-anim slide-from-left">
    <!-- Layer 3: Content Swap (uses opacity only) -->
    <div class="crossfade-stack">
      <Transition name="crossfade">
        <ContentComponent :key="contentId" />
      </Transition>
    </div>
  </div>
</div>
```

```css
/* Layer 1: Layout owns placement via Grid/Flexbox - never animated */
.layout-column {
  grid-area: sidebar;
  display: flex;
  align-items: center;
}

/* Layer 2: Entrance animation owns transform */
.entrance-anim {
  will-change: transform, opacity;
}

.slide-from-left {
  animation: slideFromLeft 0.35s ease-out;
}

@keyframes slideFromLeft {
  from { opacity: 0; transform: translateX(-40px); }
  to { opacity: 1; transform: translateX(0); }
}

/* Layer 3: Crossfade owns opacity only (no transform) */
.crossfade-stack {
  display: grid;
}

.crossfade-stack > * {
  grid-area: 1 / 1;  /* Stack children for overlap during transition */
}

.crossfade-enter-active,
.crossfade-leave-active {
  transition: opacity 0.4s ease;
}

.crossfade-enter-from,
.crossfade-leave-to {
  opacity: 0;
}
```

---

### 2. CSS Grid for Responsive Layouts

**Use CSS Grid for page-level layouts.** It keeps elements in normal document flow, preventing overlap issues that plague absolute positioning.

#### Pattern: Adaptive Column Layout

```css
.page-layout {
  display: grid;
  /* Default: single centered column */
  grid-template-columns: 1fr;
  grid-template-areas: "main";
  justify-items: center;
}

/* Expand to multi-column when content requires it */
.page-layout.has-sidebars {
  grid-template-columns: var(--sidebar-left-width) 1fr var(--sidebar-right-width);
  grid-template-areas: "left main right";
  justify-items: stretch;
}

.sidebar-left { grid-area: left; }
.main-content { grid-area: main; }
.sidebar-right { grid-area: right; }
```

---

### 3. Designer Knobs: CSS Custom Properties

**Define layout tunables as CSS custom properties at the screen level.** This gives designers clear, safe knobs to adjust without breaking functionality.

```css
.my-screen {
  /*
    Designer Knobs:
    - Column widths use clamp() for fluid scaling with min/max bounds.
    - Gap controls spacing between columns.
    - These won't break animations since layout is in normal flow.
  */
  --layout-sidebar-width: clamp(200px, 20vw, 300px);
  --layout-details-width: clamp(240px, 22vw, 320px);
  --layout-gap: clamp(24px, 4vw, 60px);
  
  /* Animation timing (safe to tweak) */
  --anim-entrance-duration: 0.35s;
  --anim-crossfade-duration: 0.4s;
}
```

#### Rules for Designer Knobs

1. **Define at screen level**, not component level - screens compose components
2. **Use `clamp(min, preferred, max)`** for responsive values
3. **Comment what each knob controls** so designers know what's safe to change
4. **Never put layout values in animated elements** - keep them in the grid/flex container

---

### 4. Responsive Breakpoints

**Design mobile-first, then add complexity for larger screens.** Graceful degradation means removing luxuries, not cramming everything in.

#### Standard Breakpoints

| Breakpoint | Target | Strategy |
|------------|--------|----------|
| Default | Mobile (<768px) | Single column, essential content only |
| `@media (min-width: 768px)` | Tablet | Add secondary content, 2-column possible |
| `@media (min-width: 1200px)` | Desktop | Full experience, sidebars, previews |

#### Pattern: Progressive Enhancement

```css
/* Mobile-first: single column */
.page-layout {
  grid-template-columns: 1fr;
  grid-template-areas: "main" "details";
}

.sidebar-preview {
  display: none;  /* Luxury content hidden on mobile */
}

/* Tablet: add details sidebar */
@media (min-width: 768px) {
  .page-layout.has-selection {
    grid-template-columns: 1fr var(--layout-details-width);
    grid-template-areas: "main details";
  }
}

/* Desktop: full 3-column with preview */
@media (min-width: 1200px) {
  .page-layout.has-selection {
    grid-template-columns: var(--layout-sidebar-width) 1fr var(--layout-details-width);
    grid-template-areas: "preview main details";
  }
  
  .sidebar-preview {
    display: flex;
  }
}
```

#### Mobile Layout Principles

**Let content dictate height on mobile.** Don't force layouts to fill the viewport - this pushes footers off-screen.

```css
/* Desktop: flex-grow to fill viewport looks good */
.page-layout {
  flex: 1;
  min-height: 100vh;
}

/* Mobile: content-sized, no forced expansion */
@media (max-width: 768px) {
  .page-container {
    min-height: auto;  /* Don't force viewport height */
  }
  
  .page-layout {
    flex: none;  /* Don't expand - let content dictate height */
  }
  
  .footer {
    padding-bottom: env(safe-area-inset-bottom, 20px);  /* iOS safe area */
  }
}
```

**Use `overflow-x: hidden` to prevent horizontal scrollbar from animations**, not to control vertical scroll:

```css
.animated-container {
  overflow-x: hidden;  /* Prevents scrollbar from slide-in animations */
}
```

---

### 5. Component vs. Screen Responsibilities

#### Screens (Composition Layer)
- Define layout grid and areas
- Own designer knobs (CSS custom properties)
- Handle responsive breakpoints
- Apply entrance animations to containers

#### Components (Leaf Layer)
- Draw their own content
- Never set their own position (parent owns placement)
- May define internal spacing/padding
- Should have fixed or intrinsic sizing (no shrink-to-fit surprises)

```vue
<!-- Screen: owns layout, knobs, breakpoints -->
<template>
  <div class="my-screen">
    <div class="layout-sidebar">
      <div class="entrance-anim">
        <MyComponent />  <!-- Component just draws itself -->
      </div>
    </div>
  </div>
</template>

<style scoped>
.my-screen {
  --sidebar-width: 280px;
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
}

.layout-sidebar {
  grid-area: 1 / 1;
}
</style>
```

```vue
<!-- Component: just draws content, parent handles placement -->
<template>
  <div class="my-component">
    <!-- Content -->
  </div>
</template>

<style scoped>
.my-component {
  /* Own sizing, not positioning */
  width: 260px;
  padding: 20px;
  background: var(--palette-background-paper);
}
</style>
```

---

## Anti-Patterns

### Absolute Positioning for Page Layout

```css
/* BAD: Takes element out of flow, causes overlap on resize */
.sidebar {
  position: absolute;
  left: 60px;
  top: 50%;
  transform: translateY(-50%);
}
```

Use CSS Grid instead - elements stay in flow and respond to viewport changes.

### Transform for Both Centering and Animation

```css
/* BAD: Animation will overwrite the centering transform */
.centered-panel {
  transform: translateY(-50%);
  animation: slideIn 0.3s;
}
```

Use Grid/Flexbox for centering, reserve transform for animations only.

### Shrink-to-Fit Width on Animated Content

```css
/* BAD: Width changes during crossfade cause pixel shifts */
.crossfade-stack > * {
  width: auto;  /* Will shrink to content, causing jitter */
}
```

Give animated containers explicit widths or `width: 100%`.

### Hardcoded Pixel Values Throughout

```css
/* BAD: Not responsive, hard to tune */
.sidebar { width: 280px; }
.gap { margin: 40px; }
```

Use CSS custom properties with `clamp()` for responsive bounds.

---

## Quick Reference

| Concern | Element | CSS Property | Can Animate? |
|---------|---------|--------------|--------------|
| Page layout | Grid container | `grid-template-*` | No |
| Column placement | Grid child | `grid-area` | No |
| Centering | Flex/Grid container | `align-items`, `justify-content` | No |
| Entrance animation | Wrapper div | `transform`, `opacity` | Yes |
| Content crossfade | Stacked container | `opacity` only | Yes |
| Spacing | Any | CSS custom property | Via transition |
```
