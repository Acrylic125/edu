# Shared learning UI

`@edu/ui` owns the desktop renderer’s page structure and presentation. It ships
TypeScript source, bundled by Vite with the desktop app’s React runtime.

- `@edu/ui/workspace`: responsive workspace frame, topic sidebar/navigation,
  document pane, and tutor-chat pane.
- `@edu/ui/learning`: new-topic screen, learning suggestions, and document layout.
- `@edu/ui/chat`: chat panel, composer layout, conversation scroll area, and
  message containers.
- `@edu/ui/theme`: theme provider and appearance state.
- `@edu/ui/theme.css`: theme tokens and Tailwind source registration.

The desktop app supplies routing, topic data, message/document renderers, and action
handlers. This package has no Next.js, Electron, authentication, store, or
network dependencies.

Install from the repository root before installing or building the desktop app:

```sh
pnpm --dir packages/ui install --frozen-lockfile
```

The desktop app uses a local `link:` dependency. Keep React and its types aligned
across the package and desktop app so source imports do not create incompatible
hook or ref types.
