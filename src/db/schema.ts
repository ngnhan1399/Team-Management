import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";

const timestampTextDefault = sql`CURRENT_TIMESTAMP::text`;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "ctv"] }).notNull().default("ctv"),
  isLeader: boolean("is_leader").notNull().default(false),
  employeeCode: text("employee_code"),
  collaboratorId: integer("collaborator_id"),
  teamId: integer("team_id"),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  lastLogin: text("last_login"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerUserId: integer("owner_user_id"),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const collaborators = pgTable("collaborators", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  name: text("name").notNull(),
  penName: text("pen_name").notNull(),
  role: text("role", { enum: ["writer", "reviewer"] }).notNull().default("writer"),
  kpiStandard: integer("kpi_standard").notNull().default(25),
  email: text("email"),
  phone: text("phone"),
  dateOfBirth: text("date_of_birth"),
  cccd: text("cccd"),
  cccdDate: text("cccd_date"),
  taxId: text("tax_id"),
  bankAccount: text("bank_account"),
  bankName: text("bank_name"),
  avatar: text("avatar"),
  bio: text("bio"),
  socialFacebook: text("social_facebook"),
  socialZalo: text("social_zalo"),
  socialTiktok: text("social_tiktok"),
  deadline: text("deadline"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
});

export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  articleId: text("article_id"),
  date: text("date").notNull(),
  title: text("title").notNull(),
  penName: text("pen_name").notNull(),
  createdByUserId: integer("created_by_user_id"),
  category: text("category", { enum: ["ICT", "Gia dụng", "Thủ thuật", "Giải trí", "Đánh giá", "SEO AI", "Khác"] }).notNull().default("ICT"),
  articleType: text("article_type", {
    enum: [
      "Mô tả SP ngắn", "Mô tả SP dài", "Bài dịch Review SP",
      "Bài SEO ICT", "Bài SEO Gia dụng",
      "Bài SEO ICT 1K5", "Bài SEO Gia dụng 1K5",
      "Bài SEO ICT 2K", "Bài SEO Gia dụng 2K",
      "Thủ thuật", "SEO AI",
    ],
  }).notNull().default("Bài SEO ICT"),
  contentType: text("content_type", { enum: ["Viết mới", "Viết lại"] }).notNull().default("Viết mới"),
  wordCountRange: text("word_count_range", {
    enum: ["800-1000", "1000-1500", "1500-2000", "Từ 2000 trở lên"],
  }),
  status: text("status", {
    enum: ["Draft", "Submitted", "Reviewing", "NeedsFix", "Approved", "Published", "Rejected"],
  }).notNull().default("Submitted"),
  link: text("link"),
  linkHealthStatus: text("link_health_status", { enum: ["ok", "broken", "unknown"] }),
  linkHealthCheckedAt: text("link_health_checked_at"),
  linkHealthCheckSlot: text("link_health_check_slot"),
  reviewLink: text("review_link"),
  reviewerName: text("reviewer_name"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const articleSyncLinks = pgTable("article_sync_links", {
  id: serial("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  sheetName: text("sheet_name").notNull(),
  sheetMonth: integer("sheet_month").notNull(),
  sheetYear: integer("sheet_year").notNull(),
  sourceRowKey: text("source_row_key").notNull(),
  articleIdRef: integer("article_id_ref"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const contentWorkRegistrations = pgTable("content_work_registrations", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull(),
  teamId: integer("team_id"),
  requestedByUserId: integer("requested_by_user_id").notNull(),
  penName: text("pen_name").notNull(),
  title: text("title").notNull(),
  articleLink: text("article_link"),
  contentWorkCategory: text("content_work_category"),
  status: text("status", {
    enum: ["queued", "submitting_form", "form_submitted", "link_written", "completed", "failed"],
  }).notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  externalSheetName: text("external_sheet_name"),
  externalRowNumber: integer("external_row_number"),
  automationMessage: text("automation_message"),
  lastError: text("last_error"),
  formSubmittedAt: text("form_submitted_at"),
  linkWrittenAt: text("link_written_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const kpiContentRegistrationBatches = pgTable("kpi_content_registration_batches", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  requestedByUserId: integer("requested_by_user_id").notNull(),
  employeeCode: text("employee_code").notNull(),
  batchKey: text("batch_key").notNull(),
  batchSize: integer("batch_size").notNull().default(1),
  taskLabel: text("task_label").notNull(),
  detailLabel: text("detail_label").notNull(),
  status: text("status", {
    enum: ["queued", "submitting_form", "form_submitted", "completed", "failed"],
  }).notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  automationMessage: text("automation_message"),
  lastError: text("last_error"),
  submittedAt: text("submitted_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const kpiContentRegistrations = pgTable("kpi_content_registrations", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull(),
  teamId: integer("team_id"),
  requestedByUserId: integer("requested_by_user_id").notNull(),
  employeeCode: text("employee_code").notNull(),
  batchId: text("batch_id").notNull(),
  batchPosition: integer("batch_position").notNull().default(1),
  batchSize: integer("batch_size").notNull().default(1),
  groupedArticleIds: text("grouped_article_ids"),
  penName: text("pen_name").notNull(),
  title: text("title").notNull(),
  articleLink: text("article_link"),
  articleDate: text("article_date").notNull(),
  articleStatus: text("article_status").notNull(),
  taskLabel: text("task_label").notNull(),
  detailLabel: text("detail_label").notNull(),
  status: text("status", {
    enum: ["queued", "submitting_form", "form_submitted", "completed", "failed"],
  }).notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  automationMessage: text("automation_message"),
  lastError: text("last_error"),
  submittedAt: text("submitted_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const reviewRegistrations = pgTable("review_registrations", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull(),
  teamId: integer("team_id"),
  requestedByUserId: integer("requested_by_user_id").notNull(),
  writerPenName: text("writer_pen_name").notNull(),
  reviewerPenName: text("reviewer_pen_name").notNull(),
  title: text("title").notNull(),
  articleLink: text("article_link"),
  articleDate: text("article_date").notNull(),
  sheetName: text("sheet_name").notNull(),
  sheetMonth: integer("sheet_month"),
  sheetYear: integer("sheet_year"),
  status: text("status", {
    enum: ["queued", "writing_sheet", "completed", "failed"],
  }).notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  externalSheetName: text("external_sheet_name"),
  externalRowNumber: integer("external_row_number"),
  automationMessage: text("automation_message"),
  lastError: text("last_error"),
  sheetWrittenAt: text("sheet_written_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const articleComments = pgTable("article_comments", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull(),
  userId: integer("user_id").notNull(),
  penName: text("pen_name").notNull(),
  content: text("content").notNull(),
  mentions: text("mentions"),
  attachmentUrl: text("attachment_url"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
});

export const editorialTasks = pgTable("editorial_tasks", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  title: text("title").notNull(),
  description: text("description"),
  assigneePenName: text("assignee_pen_name").notNull(),
  dueDate: text("due_date").notNull(),
  remindAt: text("remind_at"),
  status: text("status", { enum: ["todo", "in_progress", "done", "overdue"] }).notNull().default("todo"),
  priority: text("priority", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const kpiRecords = pgTable("kpi_records", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  penName: text("pen_name").notNull(),
  kpiStandard: integer("kpi_standard").notNull().default(25),
  kpiActual: integer("kpi_actual").notNull().default(0),
  evaluation: text("evaluation"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
});

export const kpiMonthlyTargets = pgTable("kpi_monthly_targets", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  role: text("role", { enum: ["writer", "reviewer"] }).notNull(),
  targetKpi: integer("target_kpi").notNull().default(0),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const royaltyRates = pgTable("royalty_rates", {
  id: serial("id").primaryKey(),
  articleType: text("article_type").notNull(),
  contentType: text("content_type", { enum: ["Viết mới", "Viết lại"] }).notNull(),
  price: integer("price").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  penName: text("pen_name").notNull(),
  totalArticles: integer("total_articles").notNull().default(0),
  totalAmount: integer("total_amount").notNull().default(0),
  details: text("details"),
  status: text("status", { enum: ["pending", "approved", "paid"] }).notNull().default("pending"),
  approvedByUserId: integer("approved_by_user_id"),
  approvedAt: text("approved_at"),
  paidAt: text("paid_at"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id"),
  toUserId: integer("to_user_id").notNull(),
  toPenName: text("to_pen_name"),
  type: text("type", { enum: ["deadline", "review", "error_fix", "comment", "info", "system"] }).notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedArticleId: integer("related_article_id"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
});

export const articleReviews = pgTable("article_reviews", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull(),
  reviewerUserId: integer("reviewer_user_id"),
  errorNotes: text("error_notes"),
  ctvResponse: text("ctv_response"),
  status: text("status", { enum: ["pending", "fixed", "confirmed"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const monthlyBudgets = pgTable("monthly_budgets", {
  id: serial("id").primaryKey(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  budgetAmount: integer("budget_amount").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  payload: text("payload"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
});

export const feedbackEntries = pgTable("feedback_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  collaboratorId: integer("collaborator_id"),
  teamId: integer("team_id"),
  submitterName: text("submitter_name").notNull(),
  submitterEmail: text("submitter_email").notNull(),
  category: text("category", { enum: ["bug", "feature", "improvement", "other"] }).notNull().default("improvement"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  pageContext: text("page_context"),
  rating: integer("rating"),
  status: text("status", { enum: ["new", "reviewing", "planned", "resolved"] }).notNull().default("new"),
  adminNotes: text("admin_notes"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
  updatedAt: text("updated_at").notNull().default(timestampTextDefault),
});

export const realtimeEvents = pgTable("realtime_events", {
  id: serial("id").primaryKey(),
  channels: text("channels").notNull(),
  userScope: text("user_scope").notNull().default("*"),
  toastTitle: text("toast_title"),
  toastMessage: text("toast_message"),
  toastVariant: text("toast_variant", { enum: ["info", "success", "warning", "error"] }).default("info"),
  createdAt: text("created_at").notNull().default(timestampTextDefault),
});

export type User = typeof users.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Collaborator = typeof collaborators.$inferSelect;
export type NewCollaborator = typeof collaborators.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type ArticleSyncLink = typeof articleSyncLinks.$inferSelect;
export type KpiContentRegistrationBatch = typeof kpiContentRegistrationBatches.$inferSelect;
export type ContentWorkRegistration = typeof contentWorkRegistrations.$inferSelect;
export type KpiContentRegistration = typeof kpiContentRegistrations.$inferSelect;
export type ReviewRegistration = typeof reviewRegistrations.$inferSelect;
export type ArticleComment = typeof articleComments.$inferSelect;
export type EditorialTask = typeof editorialTasks.$inferSelect;
export type KpiRecord = typeof kpiRecords.$inferSelect;
export type RoyaltyRate = typeof royaltyRates.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ArticleReview = typeof articleReviews.$inferSelect;
export type MonthlyBudget = typeof monthlyBudgets.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type FeedbackEntry = typeof feedbackEntries.$inferSelect;
export type RealtimeEventRow = typeof realtimeEvents.$inferSelect;
