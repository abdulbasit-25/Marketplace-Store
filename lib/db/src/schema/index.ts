import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type ProductImageRecord = { url: string; publicId: string };
export type CartLineRecord = { productId: string; quantity: number };
export type OrderLineRecord = {
  productId: string;
  title: string;
  price: number;
  quantity: number;
  image: string;
  sellerId: string;
};
export type ShippingAddressRecord = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const productsTable = pgTable("products", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(),
  category: text("category").notNull(),
  images: jsonb("images").$type<ProductImageRecord[]>().notNull(),
  stock: integer("stock").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  sellerId: text("seller_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cartsTable = pgTable(
  "carts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    items: jsonb("items").$type<CartLineRecord[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("carts_user_idx").on(table.userId)],
);

export const ordersTable = pgTable("orders", {
  id: text("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  buyerId: text("buyer_id").notNull(),
  items: jsonb("items").$type<OrderLineRecord[]>().notNull(),
  totalAmount: integer("total_amount").notNull(),
  status: text("status").notNull().default("placed"),
  shippingAddress: jsonb("shipping_address").$type<ShippingAddressRecord>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type Product = typeof productsTable.$inferSelect;
export type Cart = typeof cartsTable.$inferSelect;
export type Order = typeof ordersTable.$inferSelect;