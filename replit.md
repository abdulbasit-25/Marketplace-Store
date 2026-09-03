# Luma Marketplace

Luma is a warm, full-stack marketplace storefront for browsing products, creating seller listings, maintaining a persistent cart, and placing stock-aware orders.

## Run & Operate

- `pnpm install` — install workspace dependencies
- `pnpm --filter @workspace/db run push` — apply the development database schema
- `pnpm --filter @workspace/api-server run seed` — add demo users and products
- `pnpm --filter @workspace/api-server run dev` — run the API service
- `pnpm --filter @workspace/marketplace-store run dev` — run the storefront
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck and build all packages

The app uses the workspace-managed PostgreSQL database through `DATABASE_URL` during development. The requested MongoDB and Cloudinary variable names are preserved in `.env.local.example` for future external-service configuration.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Wouter, TanStack Query, Tailwind CSS
- API: Express 5 with generated OpenAPI client contracts
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod 4 generated from OpenAPI
- Auth: JWT in an httpOnly cookie, bcrypt password hashing
- Uploads: server-only Cloudinary REST upload when configured

## Where things live

- `artifacts/marketplace-store/src/` — storefront routes, screens, components, API hooks, and theme
- `artifacts/api-server/src/routes/marketplace.ts` — auth, products, categories, cart, orders, and upload endpoints
- `artifacts/api-server/src/lib/auth.ts` — JWT cookie session helpers
- `artifacts/api-server/src/lib/marketplace.ts` — response hydration and marketplace helpers
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/api-client-react/src/generated/` — generated TanStack Query hooks and client types
- `lib/api-zod/src/generated/` — generated server validation schemas
- `lib/db/src/schema/index.ts` — Drizzle tables and JSON record types
- `artifacts/api-server/src/seed.ts` — idempotent demo data

## Architecture decisions

- The provided workspace uses a shared Express API and managed PostgreSQL database, so the marketplace is implemented on that platform-native path rather than introducing a second backend process.
- Product prices are integer cents, and cart/order line items snapshot server-trusted prices at add/checkout time.
- Cart and product image gallery metadata are persisted in PostgreSQL JSONB fields to keep the first version compact while preserving real persistence.
- Checkout runs in a database transaction and uses conditional stock decrements so concurrent requests cannot oversell inventory.
- Image upload is intentionally server-only. It returns a clear configuration response until the Cloudinary values are added.

## Product

Luma includes public product discovery with search, category and sort filters, product detail galleries, authenticated seller listing management, JWT account flows, persistent carts, shipping-address checkout, buyer order history, seller incoming orders, and status transitions.

## Gotchas

- The API workflow and storefront workflow are separate services routed through the workspace proxy.
- Run OpenAPI codegen after changing `lib/api-spec/openapi.yaml`.
- The generated Zod output requires Zod 4; the workspace catalog is pinned accordingly.
- Add real deployment secrets in the hosting environment; never commit `.env.local`.
