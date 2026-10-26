CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY,
	"service" text NOT NULL,
	"date" text NOT NULL,
	"time" text NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"whatsapp_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
