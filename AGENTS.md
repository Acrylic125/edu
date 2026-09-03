---
description: Use this as an implementation guide
alwaysApply: true
---

# Rules

## General

* Do not abuse ternaries. Prefer `if` blocks when logic has multiple branches or becomes difficult to scan.

```ts
// Avoid
const status = loading ? "loading" : error ? "error" : data ? "success" : "idle";

// Prefer
let status = "idle";

if (loading) {
  status = "loading";
} else if (error) {
  status = "error";
} else if (data) {
  status = "success";
}
```

* Do not overabstract. Only abstract functionality when it is used more than once or when the abstraction represents a meaningful domain concept.

```ts
// Avoid
function getUserName(user: User) {
  return user.name;
}

const name = getUserName(user);

// Prefer
const name = user.name;
```

* Do not create functions whose sole purpose is to wrap another function or object without adding meaningful behavior.

```ts
// Avoid
function getUser(id: string) {
  return db.user.findUnique({ where: { id } });
}

// Prefer
const user = await db.user.findUnique({
  where: { id },
});
```

* Do not typecast raw JSON blobs without validation unless the data is already validated by an SDK or trusted typed boundary. Use Zod in TypeScript and Pydantic in Python.

```ts
// Avoid
const config = JSON.parse(raw) as Config;

// Prefer
const ConfigSchema = z.object({
  endpoint: z.string().url(),
  enabled: z.boolean(),
});

const config = ConfigSchema.parse(JSON.parse(raw));
```

```python
# Avoid
config: Config = json.loads(raw)

# Prefer
config = Config.model_validate_json(raw)
```

* Do not invent types unless necessary. Always check whether the library, SDK, schema, ORM, or API client already exposes the type.

```ts
// Avoid
type User = {
  id: string;
  email: string;
};

// Prefer when using Prisma
type User = Prisma.UserGetPayload<{}>;
```

Better yet, where possible, let the value infer the type without introducing an alias.

* Only use comments to explain **why** something exists: limitations, non-obvious constraints, trade-offs, workarounds, or reasoning. Do not narrate what the code already says.

```ts
// Avoid
// Loop through users
for (const user of users) {
  processUser(user);
}

// Good
// Process sequentially because the upstream API rate-limits concurrent requests.
for (const user of users) {
  await processUser(user);
}
```

* Group related files by business domain unless otherwise specified.

```text
// Avoid
src/
  controllers/
    user.ts
    billing.ts
  services/
    user.ts
    billing.ts
  schemas/
    user.ts
    billing.ts

// Prefer
src/
  users/
    router.ts
    service.ts
    schema.ts
  billing/
    router.ts
    service.ts
    schema.ts
```

* When generating LLM prompts in code, keep them direct. Do not add unnecessary personas, filler, motivational language, or repeated instructions.

```ts
// Avoid
const prompt = `
You are an incredibly intelligent and highly experienced software engineer.
Your job is extremely important.
Please carefully analyze the following content and do your absolute best
to determine whether there are any security problems...
`;

// Prefer
const prompt = `
Review the following code for security vulnerabilities.

Return:
- vulnerability
- severity
- affected code
- reasoning

Code:
${code}
`;
```

## TypeScript

* Prefer `pnpm`.

```bash
# Avoid
npm install
yarn install

# Prefer
pnpm install
```

* Do not use `any` or `unknown`. Prefer type inference over explicitly declared types. Do not add explicit return types when TypeScript can infer them. Prefer Zod/tRPC/library inference when available.

```ts
// Avoid
function getUser(id: string): Promise<User | null> {
  return db.user.findUnique({ where: { id } });
}

// Prefer
function getUser(id: string) {
  return db.user.findUnique({ where: { id } });
}
```

```ts
// Avoid
type CreateUserInput = {
  name: string;
  email: string;
};

// Prefer
const CreateUserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;
```

* Prefer type-safe environment variables. Check whether the project already uses something such as `@t3-oss/env-*`, framework-provided environment typing, or Cloudflare environment bindings before accessing `process.env` directly.

```ts
// Avoid
const apiKey = process.env.API_KEY!;

// Prefer
const apiKey = env.API_KEY;
```

For Cloudflare Workers, prefer bindings passed through the runtime environment rather than rebuilding an environment abstraction unnecessarily.

* In React, do not use `useEffect` for state synchronization or asynchronous data fetching. Consider derived state, event handlers, React Query, tRPC, Server Components, Server Actions, or Zustand before considering `useEffect`.

```tsx
// Avoid: derived state
const [fullName, setFullName] = useState("");

useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);

// Prefer
const fullName = `${firstName} ${lastName}`;
```

```tsx
// Avoid: data fetching
useEffect(() => {
  fetch("/api/users")
    .then((res) => res.json())
    .then(setUsers);
}, []);

// Prefer
const users = useQuery({
  queryKey: ["users"],
  queryFn: getUsers,
});
```

`useEffect` is still appropriate for synchronizing React with external systems that are not controlled by React, such as browser APIs, subscriptions, or third-party imperative libraries.

* Do not wrap values in `Number(...)` or `Boolean(...)` when their types are already known. Only convert when crossing an untyped or differently typed boundary.

```ts
// Avoid
const count = Number(users.length);
const enabled = Boolean(config.enabled);

// Prefer
const count = users.length;
const enabled = config.enabled;
```

Conversion is appropriate when the input actually requires it:

```ts
const page = Number(searchParams.get("page"));
```

* Inline Tailwind classes unless the styles represent actual variants.

```tsx
// Avoid
const containerStyles = "flex items-center gap-2";

return <div className={containerStyles} />;

// Prefer
return <div className="flex items-center gap-2" />;
```

For real variants, use the project's existing variant utility where available.

```tsx
const buttonVariants = cva("rounded px-4 py-2", {
  variants: {
    intent: {
      primary: "bg-blue-500 text-white",
      danger: "bg-red-500 text-white",
    },
  },
});
```

## Python

* Prefer `uv`.

```bash
# Avoid
pip install fastapi
python -m venv .venv

# Prefer
uv add fastapi
uv sync
```

* Validate untrusted structured data with Pydantic rather than casting dictionaries into expected shapes.

```python
# Avoid
payload = json.loads(raw)
user = payload["user"]

# Prefer
class UserPayload(BaseModel):
    id: str
    email: EmailStr

payload = UserPayload.model_validate_json(raw)
```

# Rule Overrides

These rules are defaults, not absolute restrictions. They may be disregarded when explicitly requested or when an existing codebase/library requires a different pattern.

When deviating from a rule because of an explicit instruction, follow the explicit instruction.

# Implementation Response

When implementing or modifying code, indicate which rules were materially relevant to the implementation.

Keep this concise. Do not list rules that had no bearing on the change.

Example:

```text
Rules followed:
- Reused the existing SDK type instead of creating a duplicate type.
- Validated the API response with Zod instead of typecasting JSON.
- Used React Query for asynchronous data fetching instead of useEffect.
- Kept the new billing logic within the billing domain.
```

