import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, sum } from "drizzle-orm";
import {
  db,
  cartsTable,
  ordersTable,
  productsTable,
  usersTable,
  type CartLineRecord,
  type Order,
  type OrderLineRecord,
  type Product,
  type ProductImageRecord,
  type ShippingAddressRecord,
  type User,
} from "@workspace/db";

export const categories = [
  { value: "electronics", label: "Electronics" },
  { value: "clothing", label: "Clothing" },
  { value: "home", label: "Home" },
  { value: "books", label: "Books" },
  { value: "toys", label: "Toys" },
  { value: "other", label: "Other" },
] as const;

export const categoryValues = categories.map((category) => category.value);

export function imageList(value: unknown): ProductImageRecord[] {
  return Array.isArray(value) ? (value as ProductImageRecord[]) : [];
}

export function productResponse(product: Product, seller: User) {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    price: product.price,
    category: product.category,
    images: imageList(product.images),
    stock: product.stock,
    isActive: product.isActive,
    seller: { id: seller.id, name: seller.name, email: seller.email },
    createdAt: product.createdAt.toISOString(),
  };
}

export async function sellerMap(ids: string[]): Promise<Map<string, User>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const users = await db.select().from(usersTable).where(inArray(usersTable.id, unique));
  return new Map(users.map((user) => [user.id, user]));
}

export async function hydratedCart(userId: string) {
  const [cart] = await db.select().from(cartsTable).where(eq(cartsTable.userId, userId)).limit(1);
  const lines = (cart?.items ?? []) as CartLineRecord[];
  if (!cart || !lines.length) {
    return { id: cart?.id ?? `cart-${userId}`, items: [], subtotal: 0, itemCount: 0 };
  }

  const products = await db
    .select()
    .from(productsTable)
    .where(inArray(productsTable.id, lines.map((line) => line.productId)));
  const users = await sellerMap(products.map((product) => product.sellerId));
  const productById = new Map(products.map((product) => [product.id, product]));
  const items = lines.flatMap((line) => {
    const product = productById.get(line.productId);
    const seller = product ? users.get(product.sellerId) : undefined;
    if (!product || !seller || !product.isActive) return [];
    return [{
      product: productResponse(product, seller),
      quantity: line.quantity,
      priceAtAdd: product.price,
    }];
  });
  return {
    id: cart.id,
    items,
    subtotal: items.reduce((total, item) => total + item.priceAtAdd * item.quantity, 0),
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
  };
}

export async function ensureCart(userId: string) {
  const [existing] = await db.select().from(cartsTable).where(eq(cartsTable.userId, userId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(cartsTable).values({
    id: crypto.randomUUID(),
    userId,
    items: [],
  }).returning();
  return created;
}

export async function orderResponse(order: Order) {
  const sellers = await sellerMap(order.items.map((item) => item.sellerId));
  const [buyer] = await db.select().from(usersTable).where(eq(usersTable.id, order.buyerId)).limit(1);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    items: (order.items ?? []) as OrderLineRecord[],
    totalAmount: order.totalAmount,
    status: order.status,
    shippingAddress: order.shippingAddress as ShippingAddressRecord,
    createdAt: order.createdAt.toISOString(),
    buyer: buyer ? { id: buyer.id, name: buyer.name, email: buyer.email } : { id: order.buyerId, name: "Buyer", email: "" },
    sellerIds: [...sellers.keys()],
  };
}

export function orderVisibleTo(order: Order, userId: string): boolean {
  return order.buyerId === userId || order.items.some((item) => item.sellerId === userId);
}

export function orderLines(order: Order): OrderLineRecord[] {
  return (order.items ?? []) as OrderLineRecord[];
}

export async function sellerSummary(userId: string) {
  const [listingCount] = await db.select({ value: count() }).from(productsTable).where(and(eq(productsTable.sellerId, userId), eq(productsTable.isActive, true)));
  const sellerOrders = await db.select().from(ordersTable).where(sql`${ordersTable.items}::jsonb @> ${JSON.stringify([{ sellerId: userId }])}::jsonb`);
  const relevant = sellerOrders.filter((order) => orderLines(order).some((item) => item.sellerId === userId));
  const revenue = relevant.reduce((total, order) => total + orderLines(order).filter((item) => item.sellerId === userId).reduce((sum, item) => sum + item.price * item.quantity, 0), 0);
  return {
    activeListings: Number(listingCount?.value ?? 0),
    incomingOrders: relevant.length,
    revenue,
    pendingShipments: relevant.filter((order) => order.status === "placed").length,
  };
}

export function productFilters(query: {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
}) {
  const filters = [eq(productsTable.isActive, true)];
  if (query.category) filters.push(eq(productsTable.category, query.category));
  if (query.minPrice !== undefined) filters.push(gte(productsTable.price, query.minPrice));
  if (query.maxPrice !== undefined) filters.push(lte(productsTable.price, query.maxPrice));
  if (query.q) filters.push(or(ilike(productsTable.title, `%${query.q}%`), ilike(productsTable.description, `%${query.q}%`))!);
  return and(...filters);
}

export const productSort = {
  newest: desc(productsTable.createdAt),
  price_asc: asc(productsTable.price),
  price_desc: desc(productsTable.price),
} as const;