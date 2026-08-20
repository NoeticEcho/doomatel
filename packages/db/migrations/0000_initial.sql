CREATE SCHEMA "legal";
--> statement-breakpoint
CREATE TYPE "legal"."spzi_kind" AS ENUM('deputy', 'senator', 'department', 'faction', 'regional_organ', 'federal_organ', 'other');--> statement-breakpoint
CREATE TYPE "legal"."committee_role" AS ENUM('responsible', 'profile', 'soexecutor');--> statement-breakpoint
CREATE TYPE "legal"."doc_format" AS ENUM('doc', 'docx', 'pdf', 'rtf', 'zip', 'html', 'txt', 'odt', 'other');--> statement-breakpoint
CREATE TYPE "legal"."extract_status" AS ENUM('pending', 'ok', 'ocr_ok', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "legal"."chunk_doc_kind" AS ENUM('law', 'code', 'constitution', 'decree', 'regulation', 'bill', 'bill_explanatory', 'bill_feo', 'bill_conclusion', 'bill_review', 'bill_amendments', 'bill_repeal_list', 'transcript', 'draft', 'uploaded');--> statement-breakpoint
CREATE TYPE "legal"."edge_kind" AS ENUM('amends', 'repeals', 'references', 'implements', 'interprets', 'supersedes', 'suspends', 'introduced_by', 'conflicts_with');--> statement-breakpoint
CREATE TYPE "legal"."unit_kind" AS ENUM('preamble', 'part', 'section', 'subsection', 'chapter', 'paragraph_sign', 'article', 'clause', 'item', 'subitem', 'indent', 'note', 'appendix');--> statement-breakpoint
CREATE TYPE "legal"."unit_status" AS ENUM('in_force', 'repealed', 'not_yet_in_force', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'editor', 'contributor', 'reviewer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'left');--> statement-breakpoint
CREATE TYPE "public"."organization_kind" AS ENUM('party', 'faction', 'committee', 'apparatus', 'expert', 'independent');--> statement-breakpoint
CREATE TYPE "public"."project_scope" AS ENUM('organization', 'faction', 'workgroup', 'personal');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('document', 'image', 'audio', 'video', 'link', 'archive', 'other');--> statement-breakpoint
CREATE TYPE "public"."asset_processing_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."conversation_kind" AS ENUM('direct', 'group', 'project', 'organization', 'workgroup', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."draft_kind" AS ENUM('bill', 'explanatory_note', 'financial_justification', 'repeal_list', 'amendment_table', 'conclusion', 'review', 'speech', 'presentation', 'analytical_note', 'inquiry', 'other');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('draft', 'in_review', 'approved', 'submitted', 'archived');--> statement-breakpoint
CREATE TYPE "public"."meeting_kind" AS ENUM('call', 'planning', 'plenary', 'committee', 'workgroup', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."suggestion_kind" AS ENUM('insert', 'delete', 'replace', 'comment');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('open', 'accepted', 'rejected', 'outdated');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transcript_status" AS ENUM('pending', 'transcribing', 'diarizing', 'summarizing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('pending', 'running', 'suspended', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "legal"."ref_committee" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"date_start" date,
	"date_end" date
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_convocation" (
	"id" smallint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"date_start" date,
	"date_end" date
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_document_type" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"weight" integer
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_instance" (
	"id" smallint PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_law_class" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"classifier_code" text,
	"parent_id" integer
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_phase" (
	"id" integer PRIMARY KEY NOT NULL,
	"stage_id" smallint,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_public_block" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text,
	"name" text,
	"short_name" text,
	"menu_name" text,
	"parent_id" text,
	"weight" integer,
	"is_blocked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ref_public_block_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_signatory_authority" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"weight" integer
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_stage" (
	"id" smallint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ordinal" smallint
);
--> statement-breakpoint
CREATE TABLE "legal"."ref_topic" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal"."subject_of_initiative" (
	"id" bigint PRIMARY KEY NOT NULL,
	"kind" "legal"."spzi_kind" NOT NULL,
	"name" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"date_start" date,
	"date_end" date,
	"faction_id" bigint,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal"."act" (
	"eo_number" char(16) PRIMARY KEY NOT NULL,
	"pravo_id" text,
	"complex_name" text,
	"title" text,
	"name" text,
	"number" text,
	"number_normalized" text,
	"document_date" date,
	"publish_date" date,
	"jd_reg_number" text,
	"jd_reg_date" date,
	"pages_count" integer,
	"pdf_file_length" bigint,
	"zip_file_length" bigint,
	"has_svg" boolean DEFAULT false NOT NULL,
	"signatory_authority_id" text,
	"document_type_id" text,
	"block_code" text,
	"pdf_document_sha" char(64),
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "act_pravo_id_unique" UNIQUE("pravo_id")
);
--> statement-breakpoint
CREATE TABLE "legal"."bill" (
	"number" text PRIMARY KEY NOT NULL,
	"duma_id" bigint,
	"convocation" smallint NOT NULL,
	"serial_no" integer NOT NULL,
	"name" text NOT NULL,
	"comments" text,
	"introduction_date" date,
	"law_type_id" integer,
	"law_type_name" text,
	"law_form" text,
	"sozd_url" text NOT NULL,
	"transcript_url" text,
	"responsible_committee_id" integer,
	"topic_id" integer,
	"law_class_id" integer,
	"amendment_deadline" date,
	"lawmaking_program" text,
	"issue_assignment" text,
	"issue_question" text,
	"last_event_date" date,
	"last_event_stage_id" smallint,
	"last_event_phase_id" integer,
	"last_event_solution" text,
	"status_code" smallint,
	"status_text" text,
	"fz_number" text,
	"act_eo_number" char(16),
	"api_fingerprint" text,
	"card_fingerprint" text,
	"raw_api" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_card" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_api_sync_at" timestamp with time zone,
	"last_card_sync_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_duma_id_unique" UNIQUE("duma_id")
);
--> statement-breakpoint
CREATE TABLE "legal"."bill_committee" (
	"bill_number" text NOT NULL,
	"committee_id" integer NOT NULL,
	"role" "legal"."committee_role" NOT NULL,
	CONSTRAINT "bill_committee_bill_number_committee_id_role_pk" PRIMARY KEY("bill_number","committee_id","role")
);
--> statement-breakpoint
CREATE TABLE "legal"."bill_document" (
	"bill_number" text NOT NULL,
	"document_sha" char(64) NOT NULL,
	"title" text,
	"doc_kind" text,
	"doc_date" date,
	"event_num" text,
	"sozd_guid" text,
	"ordinal" integer
);
--> statement-breakpoint
CREATE TABLE "legal"."bill_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bill_number" text NOT NULL,
	"event_num" text,
	"stage_id" smallint,
	"phase_id" integer,
	"event_date" date,
	"title" text,
	"solution" text,
	"instance" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "bill_event_natural_key" UNIQUE("bill_number","event_num","event_date","title")
);
--> statement-breakpoint
CREATE TABLE "legal"."bill_initiator" (
	"bill_number" text NOT NULL,
	"subject_id" bigint NOT NULL,
	CONSTRAINT "bill_initiator_bill_number_subject_id_pk" PRIMARY KEY("bill_number","subject_id")
);
--> statement-breakpoint
CREATE TABLE "legal"."crawl_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"http_status" integer,
	"bytes" bigint,
	"duration_ms" integer,
	"etag" text,
	"last_modified" text,
	"fetched_via" text,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal"."document" (
	"sha256" char(64) PRIMARY KEY NOT NULL,
	"storage_path" text NOT NULL,
	"format" "legal"."doc_format" NOT NULL,
	"byte_size" bigint NOT NULL,
	"page_count" integer,
	"source_url" text,
	"source_host" text,
	"extract_status" "legal"."extract_status" DEFAULT 'pending' NOT NULL,
	"extract_engine" text,
	"extract_error" text,
	"plain_text" text,
	"lang" text DEFAULT 'ru',
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"extracted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "legal"."sync_cursor" (
	"source" text PRIMARY KEY NOT NULL,
	"cursor_value" text NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal"."chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_kind" "legal"."chunk_doc_kind" NOT NULL,
	"document_sha" char(64),
	"unit_id" uuid,
	"work_uri" text,
	"expression_id" uuid,
	"bill_number" text,
	"parent_chunk_id" uuid,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"context_gloss" text,
	"embed_input" text NOT NULL,
	"token_count" integer,
	"char_start" integer,
	"char_end" integer,
	"path" text,
	"citation_short" text,
	"citation_full" text,
	"valid_from" date,
	"valid_to" date,
	"tenant_id" text DEFAULT 'public' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"owner_user_id" uuid,
	"project_id" uuid,
	"refs_out" text[],
	"orgs" text[],
	"vector_id" text,
	"embed_model" text,
	"embed_model_rev" text,
	"embed_dim" integer,
	"simhash" text,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal"."legal_edge" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" "legal"."edge_kind" NOT NULL,
	"from_uri" text NOT NULL,
	"to_uri" text NOT NULL,
	"from_unit_id" uuid,
	"to_unit_id" uuid,
	"confidence" real DEFAULT 1 NOT NULL,
	"provenance" text NOT NULL,
	"evidence" text,
	"valid_from" date,
	"valid_to" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_edge_natural_key" UNIQUE("kind","from_uri","to_uri","evidence")
);
--> statement-breakpoint
CREATE TABLE "legal"."legal_expression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_uri" text NOT NULL,
	"redaction_no" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date DEFAULT '9999-12-31' NOT NULL,
	"known_from" timestamp with time zone DEFAULT now() NOT NULL,
	"known_to" timestamp with time zone,
	"amended_by_uri" text,
	"source_document_sha" char(64),
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_expression_redaction_key" UNIQUE("work_uri","redaction_no")
);
--> statement-breakpoint
CREATE TABLE "legal"."legal_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expression_id" uuid NOT NULL,
	"work_uri" text NOT NULL,
	"parent_id" uuid,
	"kind" "legal"."unit_kind" NOT NULL,
	"number" text,
	"heading" text,
	"path" text NOT NULL,
	"path_ltree" "ltree" NOT NULL,
	"depth" smallint NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"char_start" integer,
	"char_end" integer,
	"status" "legal"."unit_status" DEFAULT 'in_force' NOT NULL,
	"citation_short" text,
	"citation_full" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_unit_path_key" UNIQUE("expression_id","path")
);
--> statement-breakpoint
CREATE TABLE "legal"."legal_work" (
	"uri" text PRIMARY KEY NOT NULL,
	"act_type" text NOT NULL,
	"number" text,
	"signed_date" date,
	"title" text,
	"short_name" text,
	"eo_number" char(16),
	"bill_number" text,
	"classifier_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"organization_id" uuid,
	"project_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"organization_id" uuid,
	"workgroup_id" uuid,
	"project_id" uuid,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"convocation" smallint,
	"duma_subject_id" text,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"display_name" text,
	"email" text,
	"phone" text,
	"avatar_url" text,
	"position" text,
	"duma_deputy_id" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"locale" text DEFAULT 'ru' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "project_scope" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" uuid,
	"workgroup_id" uuid,
	"owner_id" uuid NOT NULL,
	"bill_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"stage" text,
	"due_date" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'contributor' NOT NULL,
	"is_external" boolean DEFAULT false NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" uuid,
	"workgroup_id" uuid,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"granted_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_share_org_unique" UNIQUE("project_id","organization_id"),
	CONSTRAINT "project_share_workgroup_unique" UNIQUE("project_id","workgroup_id")
);
--> statement-breakpoint
CREATE TABLE "workgroup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" uuid,
	"is_cross_organization" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workgroup_member" (
	"workgroup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'contributor' NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workgroup_member_workgroup_id_user_id_pk" PRIMARY KEY("workgroup_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"organization_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"name" text NOT NULL,
	"storage_path" text,
	"url" text,
	"mime_type" text,
	"byte_size" bigint,
	"sha256" text,
	"extracted_text" text,
	"processing_status" "asset_processing_status" DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "conversation_kind" NOT NULL,
	"title" text,
	"project_id" uuid,
	"organization_id" uuid,
	"workgroup_id" uuid,
	"created_by" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participant" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_message_id" uuid,
	"is_muted" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "conversation_participant_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"title" text NOT NULL,
	"status" "draft_status" DEFAULT 'draft' NOT NULL,
	"parent_draft_id" uuid,
	"content" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"plain_text" text,
	"yjs_state" "bytea",
	"yjs_state_vector" "bytea",
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"kind" "suggestion_kind" NOT NULL,
	"status" "suggestion_status" DEFAULT 'open' NOT NULL,
	"anchor_block_id" text,
	"anchor_relative" jsonb,
	"quoted_text" text,
	"proposed_text" text,
	"rationale" text,
	"parent_id" uuid,
	"created_by" uuid NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"label" text,
	"content" jsonb NOT NULL,
	"plain_text" text,
	"yjs_snapshot" "bytea",
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_version_unique" UNIQUE("draft_id","version")
);
--> statement-breakpoint
CREATE TABLE "draft_yjs_update" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "draft_yjs_update_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"draft_id" uuid NOT NULL,
	"update" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"organization_id" uuid,
	"workgroup_id" uuid,
	"kind" "meeting_kind" NOT NULL,
	"title" text NOT NULL,
	"started_at" timestamp with time zone,
	"duration_sec" integer,
	"audio_asset_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" DEFAULT 'user' NOT NULL,
	"author_id" uuid,
	"agent_name" text,
	"body" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reaction" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reaction_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"organization_id" uuid,
	"workgroup_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid,
	"created_by" uuid NOT NULL,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"parent_id" uuid,
	"ordinal" real DEFAULT 0 NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" text[],
	"source_transcript_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"status" "transcript_status" DEFAULT 'pending' NOT NULL,
	"asr_model" text,
	"diarization_model" text,
	"language" text DEFAULT 'ru' NOT NULL,
	"full_text" text,
	"summary" text,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transcript_segment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transcript_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"speaker_label" text,
	"speaker_user_id" uuid,
	"speaker_name" text,
	"text" text NOT NULL,
	"confidence" real,
	CONSTRAINT "transcript_segment_ordinal" UNIQUE("transcript_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"workflow_id" text NOT NULL,
	"status" "workflow_run_status" DEFAULT 'pending' NOT NULL,
	"current_step" text,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"suspend_payload" jsonb,
	"error" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"status" "workflow_run_status" DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "legal"."ref_phase" ADD CONSTRAINT "ref_phase_stage_id_ref_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "legal"."ref_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."act" ADD CONSTRAINT "act_pdf_document_sha_document_sha256_fk" FOREIGN KEY ("pdf_document_sha") REFERENCES "legal"."document"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill" ADD CONSTRAINT "bill_convocation_ref_convocation_id_fk" FOREIGN KEY ("convocation") REFERENCES "legal"."ref_convocation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill" ADD CONSTRAINT "bill_responsible_committee_id_ref_committee_id_fk" FOREIGN KEY ("responsible_committee_id") REFERENCES "legal"."ref_committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill" ADD CONSTRAINT "bill_topic_id_ref_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "legal"."ref_topic"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill" ADD CONSTRAINT "bill_law_class_id_ref_law_class_id_fk" FOREIGN KEY ("law_class_id") REFERENCES "legal"."ref_law_class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill" ADD CONSTRAINT "bill_last_event_stage_id_ref_stage_id_fk" FOREIGN KEY ("last_event_stage_id") REFERENCES "legal"."ref_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill" ADD CONSTRAINT "bill_last_event_phase_id_ref_phase_id_fk" FOREIGN KEY ("last_event_phase_id") REFERENCES "legal"."ref_phase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_committee" ADD CONSTRAINT "bill_committee_bill_number_bill_number_fk" FOREIGN KEY ("bill_number") REFERENCES "legal"."bill"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_committee" ADD CONSTRAINT "bill_committee_committee_id_ref_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "legal"."ref_committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_document" ADD CONSTRAINT "bill_document_bill_number_bill_number_fk" FOREIGN KEY ("bill_number") REFERENCES "legal"."bill"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_document" ADD CONSTRAINT "bill_document_document_sha_document_sha256_fk" FOREIGN KEY ("document_sha") REFERENCES "legal"."document"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_event" ADD CONSTRAINT "bill_event_bill_number_bill_number_fk" FOREIGN KEY ("bill_number") REFERENCES "legal"."bill"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_event" ADD CONSTRAINT "bill_event_stage_id_ref_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "legal"."ref_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_event" ADD CONSTRAINT "bill_event_phase_id_ref_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "legal"."ref_phase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_initiator" ADD CONSTRAINT "bill_initiator_bill_number_bill_number_fk" FOREIGN KEY ("bill_number") REFERENCES "legal"."bill"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."bill_initiator" ADD CONSTRAINT "bill_initiator_subject_id_subject_of_initiative_id_fk" FOREIGN KEY ("subject_id") REFERENCES "legal"."subject_of_initiative"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."chunk" ADD CONSTRAINT "chunk_document_sha_document_sha256_fk" FOREIGN KEY ("document_sha") REFERENCES "legal"."document"("sha256") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."chunk" ADD CONSTRAINT "chunk_unit_id_legal_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "legal"."legal_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."chunk" ADD CONSTRAINT "chunk_expression_id_legal_expression_id_fk" FOREIGN KEY ("expression_id") REFERENCES "legal"."legal_expression"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."legal_edge" ADD CONSTRAINT "legal_edge_from_unit_id_legal_unit_id_fk" FOREIGN KEY ("from_unit_id") REFERENCES "legal"."legal_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."legal_edge" ADD CONSTRAINT "legal_edge_to_unit_id_legal_unit_id_fk" FOREIGN KEY ("to_unit_id") REFERENCES "legal"."legal_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."legal_expression" ADD CONSTRAINT "legal_expression_work_uri_legal_work_uri_fk" FOREIGN KEY ("work_uri") REFERENCES "legal"."legal_work"("uri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."legal_expression" ADD CONSTRAINT "legal_expression_source_document_sha_document_sha256_fk" FOREIGN KEY ("source_document_sha") REFERENCES "legal"."document"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."legal_unit" ADD CONSTRAINT "legal_unit_expression_id_legal_expression_id_fk" FOREIGN KEY ("expression_id") REFERENCES "legal"."legal_expression"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal"."legal_unit" ADD CONSTRAINT "legal_unit_work_uri_legal_work_uri_fk" FOREIGN KEY ("work_uri") REFERENCES "legal"."legal_work"("uri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_profile_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_profile_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_profile_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_id_profile_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profile"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_added_by_profile_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_share" ADD CONSTRAINT "project_share_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_share" ADD CONSTRAINT "project_share_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_share" ADD CONSTRAINT "project_share_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_share" ADD CONSTRAINT "project_share_granted_by_profile_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup" ADD CONSTRAINT "workgroup_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup" ADD CONSTRAINT "workgroup_created_by_profile_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup_member" ADD CONSTRAINT "workgroup_member_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup_member" ADD CONSTRAINT "workgroup_member_user_id_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workgroup_member" ADD CONSTRAINT "workgroup_member_added_by_profile_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_uploaded_by_profile_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_created_by_profile_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_user_id_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_created_by_profile_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_updated_by_profile_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_locked_by_profile_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_suggestion" ADD CONSTRAINT "draft_suggestion_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_suggestion" ADD CONSTRAINT "draft_suggestion_created_by_profile_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_suggestion" ADD CONSTRAINT "draft_suggestion_resolved_by_profile_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_version" ADD CONSTRAINT "draft_version_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_version" ADD CONSTRAINT "draft_version_created_by_profile_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_yjs_update" ADD CONSTRAINT "draft_yjs_update_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_audio_asset_id_asset_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_created_by_profile_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_id_profile_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_user_id_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_workgroup_id_workgroup_id_fk" FOREIGN KEY ("workgroup_id") REFERENCES "public"."workgroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_profile_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_profile_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_author_id_profile_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_transcript_id_transcript_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."transcript"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_speaker_user_id_profile_id_fk" FOREIGN KEY ("speaker_user_id") REFERENCES "public"."profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_started_by_profile_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ref_committee_current_idx" ON "legal"."ref_committee" USING btree ("is_current");--> statement-breakpoint
CREATE INDEX "spzi_kind_idx" ON "legal"."subject_of_initiative" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "spzi_faction_idx" ON "legal"."subject_of_initiative" USING btree ("faction_id");--> statement-breakpoint
CREATE INDEX "spzi_name_fts_idx" ON "legal"."subject_of_initiative" USING gin (to_tsvector('russian', "name"));--> statement-breakpoint
CREATE INDEX "act_publish_date_idx" ON "legal"."act" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX "act_number_normalized_idx" ON "legal"."act" USING btree ("number_normalized");--> statement-breakpoint
CREATE INDEX "act_document_date_idx" ON "legal"."act" USING btree ("document_date");--> statement-breakpoint
CREATE INDEX "bill_convocation_event_idx" ON "legal"."bill" USING btree ("convocation","last_event_date");--> statement-breakpoint
CREATE INDEX "bill_last_event_idx" ON "legal"."bill" USING btree ("last_event_date");--> statement-breakpoint
CREATE INDEX "bill_status_idx" ON "legal"."bill" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "bill_eo_idx" ON "legal"."bill" USING btree ("act_eo_number");--> statement-breakpoint
CREATE INDEX "bill_name_fts_idx" ON "legal"."bill" USING gin (to_tsvector('russian', "name"));--> statement-breakpoint
CREATE UNIQUE INDEX "bill_document_key" ON "legal"."bill_document" USING btree ("bill_number","document_sha",coalesce("event_num", ''));--> statement-breakpoint
CREATE INDEX "bill_document_sha_idx" ON "legal"."bill_document" USING btree ("document_sha");--> statement-breakpoint
CREATE INDEX "bill_event_bill_date_idx" ON "legal"."bill_event" USING btree ("bill_number","event_date");--> statement-breakpoint
CREATE INDEX "bill_initiator_subject_idx" ON "legal"."bill_initiator" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "crawl_log_source_idx" ON "legal"."crawl_log" USING btree ("source","fetched_at");--> statement-breakpoint
CREATE INDEX "crawl_log_url_idx" ON "legal"."crawl_log" USING btree ("url","fetched_at");--> statement-breakpoint
CREATE INDEX "document_extract_status_idx" ON "legal"."document" USING btree ("extract_status");--> statement-breakpoint
CREATE INDEX "document_source_url_idx" ON "legal"."document" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "chunk_document_idx" ON "legal"."chunk" USING btree ("document_sha","chunk_index");--> statement-breakpoint
CREATE INDEX "chunk_unit_idx" ON "legal"."chunk" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "chunk_work_idx" ON "legal"."chunk" USING btree ("work_uri");--> statement-breakpoint
CREATE INDEX "chunk_bill_idx" ON "legal"."chunk" USING btree ("bill_number");--> statement-breakpoint
CREATE INDEX "chunk_tenant_idx" ON "legal"."chunk" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "chunk_vector_idx" ON "legal"."chunk" USING btree ("vector_id");--> statement-breakpoint
CREATE INDEX "chunk_simhash_idx" ON "legal"."chunk" USING btree ("simhash");--> statement-breakpoint
CREATE INDEX "chunk_fts_idx" ON "legal"."chunk" USING gin (to_tsvector('russian', "text"));--> statement-breakpoint
CREATE INDEX "legal_edge_from_idx" ON "legal"."legal_edge" USING btree ("from_uri","kind");--> statement-breakpoint
CREATE INDEX "legal_edge_to_idx" ON "legal"."legal_edge" USING btree ("to_uri","kind");--> statement-breakpoint
CREATE INDEX "legal_edge_from_unit_idx" ON "legal"."legal_edge" USING btree ("from_unit_id");--> statement-breakpoint
CREATE INDEX "legal_expression_validity_idx" ON "legal"."legal_expression" USING btree ("work_uri","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "legal_unit_expression_idx" ON "legal"."legal_unit" USING btree ("expression_id","ordinal");--> statement-breakpoint
CREATE INDEX "legal_unit_parent_idx" ON "legal"."legal_unit" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "legal_unit_work_path_idx" ON "legal"."legal_unit" USING btree ("work_uri","path");--> statement-breakpoint
CREATE INDEX "legal_unit_ltree_idx" ON "legal"."legal_unit" USING gist ("path_ltree");--> statement-breakpoint
CREATE INDEX "legal_unit_fts_idx" ON "legal"."legal_unit" USING gin (to_tsvector('russian', "text"));--> statement-breakpoint
CREATE INDEX "legal_work_number_idx" ON "legal"."legal_work" USING btree ("number");--> statement-breakpoint
CREATE INDEX "legal_work_bill_idx" ON "legal"."legal_work" USING btree ("bill_number");--> statement-breakpoint
CREATE INDEX "legal_work_title_fts_idx" ON "legal"."legal_work" USING gin (to_tsvector('russian', coalesce("title", '')));--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_project_idx" ON "audit_log" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "membership" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "membership_org_idx" ON "membership" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "organization_parent_idx" ON "organization" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "organization_kind_idx" ON "organization" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "profile_duma_deputy_idx" ON "profile" USING btree ("duma_deputy_id");--> statement-breakpoint
CREATE INDEX "profile_name_fts_idx" ON "profile" USING gin (to_tsvector('russian', "full_name"));--> statement-breakpoint
CREATE INDEX "project_org_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_workgroup_idx" ON "project" USING btree ("workgroup_id");--> statement-breakpoint
CREATE INDEX "project_owner_idx" ON "project" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "project_bill_idx" ON "project" USING btree ("bill_number");--> statement-breakpoint
CREATE INDEX "project_name_fts_idx" ON "project" USING gin (to_tsvector('russian', "name"));--> statement-breakpoint
CREATE INDEX "project_member_user_idx" ON "project_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_share_project_idx" ON "project_share" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_share_org_idx" ON "project_share" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_share_workgroup_idx" ON "project_share" USING btree ("workgroup_id");--> statement-breakpoint
CREATE INDEX "workgroup_org_idx" ON "workgroup" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workgroup_member_user_idx" ON "workgroup_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asset_project_idx" ON "asset" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "asset_status_idx" ON "asset" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "asset_sha_idx" ON "asset" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "conversation_project_idx" ON "conversation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversation_org_idx" ON "conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_last_message_idx" ON "conversation" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_participant_user_idx" ON "conversation_participant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "draft_project_idx" ON "draft" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "draft_parent_idx" ON "draft" USING btree ("parent_draft_id");--> statement-breakpoint
CREATE INDEX "draft_fts_idx" ON "draft" USING gin (to_tsvector('russian', "title" || ' ' || coalesce("plain_text", '')));--> statement-breakpoint
CREATE INDEX "draft_suggestion_draft_idx" ON "draft_suggestion" USING btree ("draft_id","status");--> statement-breakpoint
CREATE INDEX "draft_suggestion_parent_idx" ON "draft_suggestion" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "draft_yjs_update_draft_idx" ON "draft_yjs_update" USING btree ("draft_id","id");--> statement-breakpoint
CREATE INDEX "meeting_project_idx" ON "meeting" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "message_reply_idx" ON "message" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "message_fts_idx" ON "message" USING gin (to_tsvector('russian', "body"));--> statement-breakpoint
CREATE INDEX "task_project_status_idx" ON "task" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "task_assignee_idx" ON "task" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "task_due_idx" ON "task" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "task_parent_idx" ON "task" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "task_fts_idx" ON "task" USING gin (to_tsvector('russian', "title" || ' ' || coalesce("description", '')));--> statement-breakpoint
CREATE INDEX "task_comment_task_idx" ON "task_comment" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "transcript_meeting_idx" ON "transcript" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "transcript_fts_idx" ON "transcript" USING gin (to_tsvector('russian', coalesce("full_text", '')));--> statement-breakpoint
CREATE INDEX "transcript_segment_time_idx" ON "transcript_segment" USING btree ("transcript_id","start_ms");--> statement-breakpoint
CREATE INDEX "workflow_run_project_idx" ON "workflow_run" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "workflow_run_workflow_idx" ON "workflow_run" USING btree ("workflow_id","status");--> statement-breakpoint
CREATE INDEX "workflow_step_run_idx" ON "workflow_step" USING btree ("run_id","ordinal");