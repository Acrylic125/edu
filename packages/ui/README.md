# Shared learning UI

`@edu/ui` owns the page structure and presentation used by both the web app and
the desktop renderer. It ships TypeScript source; Next.js transpiles the package
and Vite bundles it with each app's React runtime.

- `@edu/ui/workspace`: responsive workspace frame, topic sidebar/navigation,
  document pane, and tutor-chat pane.
- `@edu/ui/learning`: new-topic screen, learning suggestions, document layout,
  and table of contents.
- `@edu/ui/chat`: chat panel, composer layout, conversation scroll area, and
  message containers.
- `@edu/ui/theme`: shared theme provider and appearance menu.
- `@edu/ui/theme.css`: theme tokens and Tailwind source registration.

The apps supply routing, topic data, message/document renderers, and action
handlers. This package has no Next.js, Electron, authentication, store, or
network dependencies. An interactive learning plan accepts a selection callback;
a read-only plan uses the same component without one.

Install from the repository root before installing or building either app:

```sh
pnpm --dir packages/ui install --frozen-lockfile
```

Both consumers use a local `link:` dependency, following the existing
`chat-contract` package convention. Keep React and its types aligned across the
package and both apps so source imports do not create incompatible hook or ref
types.
