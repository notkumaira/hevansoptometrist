import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const bookings = pgTable("bookings", {
  id: serial().primaryKey(),
  service: text().notNull(),
  date: text().notNull(),
  time: text().notNull(),
  name: text().notNull(),
  phone: text().notNull().default(""),
  email: text().notNull().default(""),
  notes: text().notNull().default(""),
  whatsappStatus: text("whatsapp_status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});
