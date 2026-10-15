CREATE TABLE "actions" (
	"id" text PRIMARY KEY NOT NULL,
	"dispute_id" text NOT NULL,
	"verdict_id" text,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"debug_id" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_platforms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"kind" text NOT NULL,
	"platform_id" text,
	"merchant_id" text,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"sha256" text PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundle_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"bundle_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"sig" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_id" text NOT NULL,
	"merchant_id" text,
	"user_ref" text NOT NULL,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"status" text NOT NULL,
	"state" jsonb NOT NULL,
	"head_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"dispute_id" text,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"stage" text,
	"amount_value" numeric(14, 2),
	"amount_currency" text,
	"transaction_id" text,
	"bundle_id" text,
	"raw" jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paypal_create_time" timestamp with time zone,
	"paypal_update_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liability_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_id" text NOT NULL,
	"dispute_id" text NOT NULL,
	"verdict_id" text NOT NULL,
	"amount_value" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"paypal_merchant_id" text,
	"misrepresentation_claim_type" text DEFAULT 'REFUND' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"ref" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"dispute_id" text NOT NULL,
	"bundle_id" text,
	"verdict" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"reasons" jsonb NOT NULL,
	"rule_results" jsonb NOT NULL,
	"model_findings" jsonb NOT NULL,
	"model_id" text,
	"prompt_hash" text,
	"inputs_hash" text NOT NULL,
	"raw_model_output" text,
	"inputs" jsonb NOT NULL,
	"recommended_action" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"approved_by" text,
	"executed_action" jsonb,
	"paypal_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_platform_id_agent_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."agent_platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_dispute_idx" ON "actions" USING btree ("dispute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "bundle_events_bundle_idx" ON "bundle_events" USING btree ("bundle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_events_hash_idx" ON "bundle_events" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "bundles_order_idx" ON "bundles" USING btree ("paypal_order_id");--> statement-breakpoint
CREATE INDEX "bundles_capture_idx" ON "bundles" USING btree ("paypal_capture_id");--> statement-breakpoint
CREATE INDEX "dispute_events_dispute_idx" ON "dispute_events" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "disputes_tx_idx" ON "disputes" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "liability_verdict_idx" ON "liability_ledger" USING btree ("verdict_id");--> statement-breakpoint
CREATE INDEX "verdicts_dispute_idx" ON "verdicts" USING btree ("dispute_id");