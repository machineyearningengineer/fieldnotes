# Looseleaf primitives

Selected source from Kevin Ngo's [Looseleaf](https://kevintngo.github.io/looseleaf/) registry, retrieved 2 November 2026. MIT notice is in LICENSE. Imports are scoped to this directory; lib/utils.ts is the local class-name helper. Drawing and interaction code derives from upstream. Local changes remove remote font injection, simplify comma expressions and make hook dependencies explicit. The few lint suppressions explain stable serialised keys and callback refs. App composition and typography are outside this directory.

Only the dependency closure of Button, Paper, Drawer, DropdownMenu and Select is included. This is vendored source, not an npm runtime dependency. Update deliberately against the upstream registry and inspect the diff. Tailwind generates classes from these sources; unused modules are left out by the bundler.
