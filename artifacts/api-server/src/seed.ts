import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, productsTable, usersTable } from "@workspace/db";

const image = (url: string, publicId: string) => [{ url, publicId }];

async function seed(): Promise<void> {
  const passwordHash = await bcrypt.hash("demo1234", 12);
  const users = [
    { id: "demo-seller", name: "Maya Chen", email: "maya@luma.demo", passwordHash },
    { id: "demo-buyer", name: "Alex Morgan", email: "alex@luma.demo", passwordHash },
  ];
  for (const user of users) {
    await db.insert(usersTable).values(user).onConflictDoNothing({ target: usersTable.email });
  }

  const listings = [
    {
      id: "luma-ceramic-mug",
      title: "Hand-thrown ceramic mug",
      description: "A quiet morning ritual in a hand-thrown stoneware mug with a naturally speckled glaze.",
      price: 2800,
      category: "home",
      images: image("https://images.unsplash.com/photo-1514228742587-6b1558fcf93a?auto=format&fit=crop&w=1200&q=85", "seed-mug"),
      stock: 14,
    },
    {
      id: "luma-canvas-tote",
      title: "Everyday canvas tote",
      description: "A sturdy, soft-washed carryall with an inside pocket for the things you reach for most.",
      price: 3600,
      category: "clothing",
      images: image("https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=1200&q=85", "seed-tote"),
      stock: 22,
    },
    {
      id: "luma-brass-lamp",
      title: "Brushed brass desk lamp",
      description: "Warm, directional light for late-night reading, sketching, or a slower end to the day.",
      price: 8900,
      category: "home",
      images: image("https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1200&q=85", "seed-lamp"),
      stock: 7,
    },
    {
      id: "luma-field-notebook",
      title: "Field notes, set of three",
      description: "Pocket-sized notebooks with creamy paper for lists, sketches, and ideas that arrive unannounced.",
      price: 1800,
      category: "books",
      images: image("https://images.unsplash.com/photo-1531346878377-a5be20888e57?auto=format&fit=crop&w=1200&q=85", "seed-notebook"),
      stock: 35,
    },
    {
      id: "luma-headphones",
      title: "Studio wireless headphones",
      description: "Balanced sound, soft ear cushions, and a battery that keeps pace with a full workday.",
      price: 12900,
      category: "electronics",
      images: image("https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=85", "seed-headphones"),
      stock: 9,
    },
    {
      id: "luma-wooden-puzzle",
      title: "Woodland puzzle",
      description: "A tactile 500-piece puzzle illustrated with an easygoing forest scene for unhurried afternoons.",
      price: 4200,
      category: "toys",
      images: image("https://images.unsplash.com/photo-1606503153255-59d8b8b821c0?auto=format&fit=crop&w=1200&q=85", "seed-puzzle"),
      stock: 11,
    },
  ];

  for (const listing of listings) {
    const [existing] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, listing.id)).limit(1);
    if (!existing) {
      await db.insert(productsTable).values({ ...listing, sellerId: "demo-seller" });
    }
  }

  process.stdout.write("Luma demo data is ready. Demo seller: maya@luma.demo / demo1234. Demo buyer: alex@luma.demo / demo1234.\n");
  process.exit(0);
}

seed().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Seed failed"}\n`);
  process.exit(1);
});