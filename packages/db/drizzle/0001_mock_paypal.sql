CREATE TABLE "mock_captures" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"update_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"dispute_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes_b64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"body" jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mock_captures_order_idx" ON "mock_captures" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "mock_disputes_update_idx" ON "mock_disputes" USING btree ("update_time");