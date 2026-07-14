<script setup lang="ts">
// The Odin brand mark (Huginn and Muninn, raven-04). Single source of
// geometry: the same canonical asset the launcher icon is built from
// (task 01-07), inlined here so theme custom properties recolor it.
//
// The mark parameterizes color via three inherited custom properties:
// --logo-ink (raven 1 + its rings) and --logo-slate (raven 2 + its rings)
// are theme tokens defined at [data-theme] scope, so they cascade in
// globally. --logo-field is the carve color: it must match the surface
// the mark sits on, so it defaults to --bg here and a consumer on a
// raised surface overrides it. Inlining (not <img>/<use>) is required
// because an external or shadow-tree instance cannot be recolored by
// document custom properties.
import markSvg from '../../resources/odin-mark.svg?raw';
</script>

<template>
  <!-- markSvg is our own canonical asset, inlined at build time from
       resources/odin-mark.svg. No untrusted input reaches it. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <span class="odin-mark" aria-hidden="true" v-html="markSvg" />
</template>

<style scoped>
.odin-mark {
  display: block;

  /* Carve reads as a cut-out of the surface behind the mark; default to
     the app background, override on raised surfaces. */
  --logo-field: var(--bg);
}
</style>

<style>
/* The mark's <svg> is injected via v-html, so it sits outside scoped-style
   reach. This rule is namespaced to the unique .odin-mark block and only
   makes the svg fill (and be sized by) its holder; CSS width/height beats
   the asset's own width/height attributes, so it stays robust to how the
   canonical resources/odin-mark.svg is formatted. */
.odin-mark > svg {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
