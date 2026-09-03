import { Router, type IRouter } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  AddCartItemBody,
  AddCartItemResponse,
  CheckoutBody,
  CheckoutResponse,
  CreateProductBody,
  CreateProductResponse,
  DeleteProductParams,
  DeleteProductResponse,
  GetCartResponse,
  GetCurrentUserResponse,
  GetOrderParams,
  GetOrderResponse,
  GetProductParams,
  GetProductResponse,
  GetSellerSummaryResponse,
  ListCategoriesResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  RegisterBody,
  RegisterResponse,
  RemoveCartItemParams,
  UpdateCartItemBody,
  UpdateCartItemParams,
  UpdateCartItemResponse,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdateOrderStatusResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
  UploadImagesResponse,
} from "@workspace/api-zod";
import {
  db,
  cartsTable,
  ordersTable,
  productsTable,
  usersTable,
  type CartLineRecord,
  type OrderLineRecord,
  type ProductImageRecord,
  type ShippingAddressRecord,
} from "@workspace/db";
import { clearSession, requireUser, safeUser, setSession } from "../lib/auth";
import {
  categories,
  categoryValues,
  ensureCart,
  hydratedCart,
  orderLines,
  orderResponse,
  orderVisibleTo,
  productFilters,
  productResponse,
  productSort,
  sellerMap,
  sellerSummary,
} from "../lib/marketplace";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 6, fileSize: 5 * 1024 * 1024, fieldSize: 1000 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype.startsWith("image/")),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error";
}

router.get("/auth/me", async (request, response): Promise<void> => {
  try {
    const user = await (await import("../lib/auth")).authenticatedUser(request);
    response.json(GetCurrentUserResponse.parse({ user: user ? safeUser(user) : null }));
  } catch (error) {
    response.status(503).json({ error: errorMessage(error) });
  }
});

router.post("/auth/register", async (request, response): Promise<void> => {
  const parsed = RegisterBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const email = parsed.data.email.trim().toLowerCase();
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      response.status(409).json({ error: "An account with that email already exists" });
      return;
    }
    const [user] = await db.insert(usersTable).values({
      id: crypto.randomUUID(),
      name: parsed.data.name.trim(),
      email,
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
    }).returning();
    setSession(response, user);
    response.status(201).json(RegisterResponse.parse({ user: safeUser(user) }));
  } catch (error) {
    request.log.error({ err: error }, "Registration failed");
    response.status(503).json({ error: errorMessage(error) });
  }
});

router.post("/auth/login", async (request, response): Promise<void> => {
  const parsed = LoginBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email.trim().toLowerCase())).limit(1);
    const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
    if (!user || !valid) {
      response.status(401).json({ error: "Invalid credentials" });
      return;
    }
    setSession(response, user);
    response.json(LoginResponse.parse({ user: safeUser(user) }));
  } catch (error) {
    request.log.error({ err: error }, "Login failed");
    response.status(503).json({ error: errorMessage(error) });
  }
});

router.post("/auth/logout", (_request, response): void => {
  clearSession(response);
  response.json(LogoutResponse.parse({ message: "Signed out" }));
});

router.get("/categories", async (_request, response): Promise<void> => {
  const rows = await db.select({ category: productsTable.category, count: count() }).from(productsTable).where(eq(productsTable.isActive, true)).groupBy(productsTable.category);
  const counts = new Map(rows.map((row) => [row.category, Number(row.count)]));
  response.json(ListCategoriesResponse.parse(categories.map((category) => ({ ...category, count: counts.get(category.value) ?? 0 }))));
});

router.get("/products", async (request, response): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, q, category, minPrice, maxPrice, sort } = parsed.data;
  const filter = productFilters({ q, category, minPrice, maxPrice });
  const [totalRow] = await db.select({ value: count() }).from(productsTable).where(filter);
  const products = await db.select().from(productsTable).where(filter).orderBy(productSort[sort]).limit(limit).offset((page - 1) * limit);
  const sellers = await sellerMap(products.map((product) => product.sellerId));
  const data = products.flatMap((product) => {
    const seller = sellers.get(product.sellerId);
    return seller ? [productResponse(product, seller)] : [];
  });
  response.json(ListProductsResponse.parse({
    data,
    pagination: { page, limit, total: Number(totalRow?.value ?? 0), totalPages: Math.ceil(Number(totalRow?.value ?? 0) / limit) },
  }));
});

router.post("/products", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const parsed = CreateProductBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db.insert(productsTable).values({
    id: crypto.randomUUID(),
    ...parsed.data,
    category: parsed.data.category,
    images: parsed.data.images as ProductImageRecord[],
    sellerId: user.id,
  }).returning();
  response.status(201).json(CreateProductResponse.parse(productResponse(product, user)));
});

router.get("/products/:id", async (request, response): Promise<void> => {
  const parsed = GetProductParams.safeParse(request.params);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, parsed.data.id)).limit(1);
  if (!product || !product.isActive) {
    response.status(404).json({ error: "Product not found" });
    return;
  }
  const [seller] = await db.select().from(usersTable).where(eq(usersTable.id, product.sellerId)).limit(1);
  if (!seller) {
    response.status(404).json({ error: "Product not found" });
    return;
  }
  response.json(GetProductResponse.parse(productResponse(product, seller)));
});

router.put("/products/:id", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const params = UpdateProductParams.safeParse(request.params);
  const parsed = UpdateProductBody.safeParse(request.body);
  if (!params.success) {
    response.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const [owned] = await db.select().from(productsTable).where(and(eq(productsTable.id, params.data.id), eq(productsTable.sellerId, user.id))).limit(1);
  if (!owned) {
    response.status(403).json({ error: "You do not own this product" });
    return;
  }
  const [updated] = await db.update(productsTable).set({
    ...parsed.data,
    images: parsed.data.images as ProductImageRecord[],
  }).where(eq(productsTable.id, params.data.id)).returning();
  response.json(UpdateProductResponse.parse(productResponse(updated, user)));
});

router.delete("/products/:id", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const params = DeleteProductParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: params.error.message });
    return;
  }
  const [owned] = await db.select().from(productsTable).where(and(eq(productsTable.id, params.data.id), eq(productsTable.sellerId, user.id))).limit(1);
  if (!owned) {
    response.status(403).json({ error: "You do not own this product" });
    return;
  }
  await db.update(productsTable).set({ isActive: false }).where(eq(productsTable.id, params.data.id));
  response.json(DeleteProductResponse.parse({ message: "Product unpublished" }));
});

router.get("/cart", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  response.json(GetCartResponse.parse(await hydratedCart(user.id)));
});

router.post("/cart", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const parsed = AddCartItemBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db.select().from(productsTable).where(and(eq(productsTable.id, parsed.data.productId), eq(productsTable.isActive, true))).limit(1);
  if (!product) {
    response.status(404).json({ error: "Product not found" });
    return;
  }
  const cart = await ensureCart(user.id);
  const lines = [...((cart.items ?? []) as CartLineRecord[])];
  const existing = lines.find((line) => line.productId === parsed.data.productId);
  const quantity = (existing?.quantity ?? 0) + parsed.data.quantity;
  if (quantity > product.stock) {
    response.status(400).json({ error: `Only ${product.stock} available` });
    return;
  }
  if (existing) existing.quantity = quantity;
  else lines.push({ productId: parsed.data.productId, quantity });
  await db.update(cartsTable).set({ items: lines, updatedAt: new Date() }).where(eq(cartsTable.id, cart.id));
  response.json(AddCartItemResponse.parse(await hydratedCart(user.id)));
});

router.patch("/cart/:productId", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const params = UpdateCartItemParams.safeParse(request.params);
  const parsed = UpdateCartItemBody.safeParse(request.body);
  if (!params.success) {
    response.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const cart = await ensureCart(user.id);
  let lines = [...((cart.items ?? []) as CartLineRecord[])].filter((line) => line.productId !== params.data.productId);
  if (parsed.data.quantity > 0) {
    const [product] = await db.select().from(productsTable).where(and(eq(productsTable.id, params.data.productId), eq(productsTable.isActive, true))).limit(1);
    if (!product) {
      response.status(404).json({ error: "Product not found" });
      return;
    }
    if (parsed.data.quantity > product.stock) {
      response.status(400).json({ error: `Only ${product.stock} available` });
      return;
    }
    lines.push({ productId: params.data.productId, quantity: parsed.data.quantity });
  }
  await db.update(cartsTable).set({ items: lines, updatedAt: new Date() }).where(eq(cartsTable.id, cart.id));
  response.json(UpdateCartItemResponse.parse(await hydratedCart(user.id)));
});

router.delete("/cart/:productId", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const params = RemoveCartItemParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: params.error.message });
    return;
  }
  const cart = await ensureCart(user.id);
  const lines = ((cart.items ?? []) as CartLineRecord[]).filter((line) => line.productId !== params.data.productId);
  await db.update(cartsTable).set({ items: lines, updatedAt: new Date() }).where(eq(cartsTable.id, cart.id));
  response.json(UpdateCartItemResponse.parse(await hydratedCart(user.id)));
});

router.get("/orders/summary", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  response.json(GetSellerSummaryResponse.parse(await sellerSummary(user.id)));
});

router.get("/orders", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const parsed = ListOrdersQueryParams.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.buyerId, user.id)).orderBy(desc(ordersTable.createdAt));
  const visible = parsed.data.role === "selling"
    ? (await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt))).filter((order) => orderLines(order).some((item) => item.sellerId === user.id))
    : orders;
  const result = await Promise.all(visible.map(orderResponse));
  response.json(ListOrdersResponse.parse(result));
});

router.post("/orders", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const parsed = CheckoutBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const cart = await ensureCart(user.id);
  const lines = (cart.items ?? []) as CartLineRecord[];
  if (!lines.length) {
    response.status(400).json({ error: "Your cart is empty" });
    return;
  }
  try {
    const order = await db.transaction(async (transaction) => {
      const productRows = await transaction.select().from(productsTable).where(inArray(productsTable.id, lines.map((line) => line.productId)));
      const productById = new Map(productRows.map((product) => [product.id, product]));
      const sellers = new Set<string>();
      const snapshots: OrderLineRecord[] = [];
      for (const line of lines) {
        const product = productById.get(line.productId);
        if (!product || !product.isActive) throw new Error("A product in your cart is no longer available");
        if (product.stock < line.quantity) throw new Error(`${product.title} only has ${product.stock} left`);
        const updated = await transaction.update(productsTable).set({ stock: sql`${productsTable.stock} - ${line.quantity}` }).where(and(eq(productsTable.id, product.id), sql`${productsTable.stock} >= ${line.quantity}`)).returning();
        if (!updated.length) throw new Error(`${product.title} sold out while you were checking out`);
        sellers.add(product.sellerId);
        snapshots.push({
          productId: product.id,
          title: product.title,
          price: product.price,
          quantity: line.quantity,
          image: (product.images as ProductImageRecord[])[0]?.url ?? "",
          sellerId: product.sellerId,
        });
      }
      const [created] = await transaction.insert(ordersTable).values({
        id: crypto.randomUUID(),
        orderNumber: `LUMA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
        buyerId: user.id,
        items: snapshots,
        totalAmount: snapshots.reduce((total, item) => total + item.price * item.quantity, 0),
        status: "placed",
        shippingAddress: parsed.data as ShippingAddressRecord,
      }).returning();
      await transaction.update(cartsTable).set({ items: [], updatedAt: new Date() }).where(eq(cartsTable.id, cart.id));
      return created;
    });
    response.status(201).json(CheckoutResponse.parse(await orderResponse(order)));
  } catch (error) {
    response.status(409).json({ error: errorMessage(error) });
  }
});

router.get("/orders/:id", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const params = GetOrderParams.safeParse(request.params);
  if (!params.success) {
    response.status(400).json({ error: params.error.message });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).limit(1);
  if (!order) {
    response.status(404).json({ error: "Order not found" });
    return;
  }
  if (!orderVisibleTo(order, user.id)) {
    response.status(403).json({ error: "You do not have access to this order" });
    return;
  }
  response.json(GetOrderResponse.parse(await orderResponse(order)));
});

router.patch("/orders/:id", async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const params = UpdateOrderStatusParams.safeParse(request.params);
  const parsed = UpdateOrderStatusBody.safeParse(request.body);
  if (!params.success) {
    response.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.message });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).limit(1);
  if (!order) {
    response.status(404).json({ error: "Order not found" });
    return;
  }
  if (!orderLines(order).some((item) => item.sellerId === user.id)) {
    response.status(403).json({ error: "Only a seller on this order can update its status" });
    return;
  }
  if (parsed.data.status !== "shipped" && parsed.data.status !== "cancelled") {
    response.status(400).json({ error: "Invalid status transition" });
    return;
  }
  const [updated] = await db.update(ordersTable).set({ status: parsed.data.status }).where(eq(ordersTable.id, order.id)).returning();
  response.json(UpdateOrderStatusResponse.parse(await orderResponse(updated)));
});

router.post("/upload", upload.array("files", 6), async (request, response): Promise<void> => {
  const user = await requireUser(request, response);
  if (!user) return;
  const files = (request.files ?? []) as Express.Multer.File[];
  if (!files.length) {
    response.status(400).json({ error: "Choose at least one image" });
    return;
  }
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    response.status(503).json({ error: "Image uploads are not configured yet. Add the Cloudinary environment variables to enable them." });
    return;
  }
  try {
    const uploaded: ProductImageRecord[] = [];
    for (const file of files) {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto.createHash("sha1").update(`folder=luma-products&timestamp=${timestamp}${apiSecret}`).digest("hex");
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
      form.append("api_key", apiKey);
      form.append("timestamp", timestamp.toString());
      form.append("folder", "luma-products");
      form.append("signature", signature);
      const cloudResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
      if (!cloudResponse.ok) throw new Error("Cloudinary rejected an image upload");
      const payload = await cloudResponse.json() as { secure_url: string; public_id: string };
      uploaded.push({ url: payload.secure_url, publicId: payload.public_id });
    }
    response.json(UploadImagesResponse.parse(uploaded));
  } catch (error) {
    request.log.error({ err: error }, "Image upload failed");
    response.status(502).json({ error: "Image upload failed. Check the Cloudinary configuration and try again." });
  }
});

export default router;