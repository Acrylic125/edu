
```ts
type PageRange = {
  from: number,
  to: number
}

type Reference = {
  type: "pdf" | "ppt",
  path: string,
  pages: PageRange[]
} | {
  type: "other-file",
  path: string,
} | {
  type: "image",
  path: string
} | {
  type: "website",
  url: string
} | {
  type: "topic",
  id: string
}

type Generic = {
  version: "19-10-2026",
  createdAt: Date, // serialized as string
  name: string,
  references: Reference[]
}

type GenericScratchpadType = {
    type: "test",
} & Generic
```