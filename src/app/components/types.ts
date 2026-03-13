export type Page = "dashboard" | "articles" | "tasks" | "team" | "royalty" | "notifications" | "feedback" | "audit" | "profile";

export interface Collaborator {
  id: number;
  teamId?: number | null;
  name: string;
  penName: string;
  role: "writer" | "reviewer";
  kpiStandard: number;
  status: string;
  email?: string;
  phone?: string;
  avatar?: string;
  bio?: string;
  socialFacebook?: string;
  socialZalo?: string;
  socialTiktok?: string;
  linkedUserId?: number | null;
  linkedUserEmail?: string | null;
  linkedUserRole?: "admin" | "ctv" | null;
  linkedUserIsLeader?: boolean;
  linkedUserTeamId?: number | null;
}

export interface UserAccount {
  id: number;
  email: string;
  role: "admin" | "ctv";
  isLeader?: boolean;
  collaboratorId: number | null;
  teamId?: number | null;
}

export interface TeamSummary {
  id: number;
  name: string;
  description: string | null;
  status: "active" | "archived";
  ownerUserId: number | null;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerPenName: string | null;
  memberCount: number;
  writerCount: number;
  reviewerCount: number;
  adminCount: number;
}

export interface Article {
  id: number;
  articleId: string;
  date: string;
  title: string;
  penName: string;
  authorBucket?: "ctv" | "editorial";
  authorBucketLabel?: string;
  authorRole?: "writer" | "reviewer" | null;
  authorUserRole?: "admin" | "ctv" | null;
  createdByUserId?: number | null;
  updatedAt?: string;
  category: string;
  articleType: string;
  contentType: string;
  wordCountRange: string;
  status: string;
  link: string;
  reviewLink?: string | null;
  reviewerName: string;
  notes: string;
  canDelete?: boolean;
  commentCount?: number;
  unreadCommentCount?: number;
}

export interface ChatMessage {
  role: "user" | "ai";
  content: string;
}

export interface NotifItem {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  relatedArticleId?: number;
}

export interface ArticleComment {
  id: number;
  articleId: number;
  userId: number;
  penName: string;
  content: string;
  mentions: string[];
  attachmentUrl: string | null;
  createdAt: string;
}

export interface EditorialTask {
  id: number;
  title: string;
  description: string | null;
  assigneePenName: string;
  dueDate: string;
  remindAt: string | null;
  status: "todo" | "in_progress" | "done" | "overdue";
  priority: "low" | "medium" | "high";
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentItem {
  id: number;
  month: number;
  year: number;
  penName: string;
  totalArticles: number;
  totalAmount: number;
  writerArticles: number;
  writerAmount: number;
  reviewerArticles: number;
  reviewerAmount: number;
  details: Record<string, { count: number; unitPrice: number; total: number }> | null;
  status: "pending" | "approved" | "paid";
  approvedByUserId: number | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  isEstimated?: boolean;
}

export interface FeedbackItem {
  id: number;
  userId: number;
  collaboratorId: number | null;
  teamId: number | null;
  submitterName: string;
  submitterEmail: string;
  category: "bug" | "feature" | "improvement" | "other";
  title: string;
  message: string;
  pageContext: string | null;
  rating: number | null;
  status: "new" | "reviewing" | "planned" | "resolved";
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStatusRow {
  status: string;
  count: number;
}

export interface DashboardCategoryRow {
  category: string;
  count: number;
}

export interface DashboardWriterRow {
  penName: string;
  displayName: string;
  count: number;
}

export interface DashboardLatestArticle {
  id: number;
  articleId: string;
  title: string;
  penName: string;
  writerDisplayName: string;
  articleType: string;
  status: string;
  date: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalArticles: number;
  totalCTVs: number;
  articlesByStatus: DashboardStatusRow[];
  articlesByCategory: DashboardCategoryRow[];
  articlesByWriter: DashboardWriterRow[];
  latestArticles?: DashboardLatestArticle[];
}

export type ImportSampleRow = Record<string, unknown>;

export interface ImportSheetInfo {
  name: string;
  totalRows: number;
  totalColumns: number;
  isHidden: boolean;
}

export interface ImportHeaderCandidate {
  rowNumber: number;
  score: number;
  preview: string[];
}

export interface ImportColumnSuggestion {
  field: string;
  score: number;
}

export interface ImportColumnAnalysis {
  key: string;
  letter: string;
  header: string;
  inferredType: string;
  sampleValues: string[];
  suggestedField: string | null;
  suggestionScore: number;
  suggestions: ImportColumnSuggestion[];
}

export interface ImportPreviewRow {
  rowNumber: number;
  values: Record<string, string>;
}

export interface ImportAnalyzeResult {
  sheetName: string;
  totalRows: number;
  dataRowCount: number;
  headerRowNumber: number;
  sheets: ImportSheetInfo[];
  headerCandidates: ImportHeaderCandidate[];
  columns: ImportColumnAnalysis[];
  mapping: Record<string, string | null>;
  sampleRows: ImportPreviewRow[];
  warnings: string[];
  requiredFieldsMissing: string[];
}

export interface ImportExecuteResult {
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
  errors: string[];
  clearedExisting?: boolean;
  sheetName?: string;
  headerRowNumber?: number;
  warnings?: string[];
}

export interface GoogleSheetSyncResult {
  total: number;
  inserted: number;
  updated: number;
  duplicates: number;
  deleted: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  sheetName: string;
  month: number;
  year: number;
  scope?: "sheet" | "workbook";
  processedSheets?: string[];
  requestedMonth?: number | null;
  requestedYear?: number | null;
  sourceUrl: string;
}

export interface ImportDryRunPreviewRow {
  rowNumber: number;
  canImport: boolean;
  duplicate: boolean;
  duplicateReason?: string;
  issues: string[];
  normalized: {
    articleId?: string;
    date?: string;
    title: string;
    penName: string;
    status: string;
    link?: string;
    reviewerName?: string;
    notes?: string;
  };
}

export interface ImportDryRunResult {
  dryRun: true;
  total: number;
  importable: number;
  duplicates: number;
  skipped: number;
  previewRows: ImportDryRunPreviewRow[];
  sheetName: string;
  headerRowNumber: number;
  warnings: string[];
}

export interface ArticleDeleteCriteria {
  search: string;
  titleQuery: string;
  penName: string;
  status: string;
  category: string;
  articleType: string;
  contentType: string;
  month: string;
  year: string;
  reviewerName: string;
}

export interface ArticleDeletePreviewItem {
  id: number;
  articleId: string | null;
  title: string;
  penName: string;
  date: string;
  status: string;
}

export interface ArticleDeletePreview {
  total: number;
  sample: ArticleDeletePreviewItem[];
  related: {
    comments: number;
    reviews: number;
    notifications: number;
    payments: number;
  };
}

export interface RoyaltyRateItem {
  id: number;
  articleType: string;
  contentType: string;
  price: number;
  isActive: boolean;
}

export interface RoyaltyBreakdownItem {
  count: number;
  unitPrice: number;
  total: number;
}

export interface RoyaltyCalculationRow {
  penName: string;
  totalArticles: number;
  totalAmount: number;
  writerArticles: number;
  writerAmount: number;
  reviewerArticles: number;
  reviewerAmount: number;
  breakdown: Record<string, RoyaltyBreakdownItem>;
}

export interface RoyaltyMonthlyDatum {
  month: number;
  year: number;
  totalAmount: number;
  totalArticles: number;
}

export interface RoyaltyTopWriter {
  penName: string;
  amount: number;
}

export interface RoyaltyContentBalance {
  newArticles: number;
  rewriteArticles: number;
  totalArticles: number;
  newPercentage: number;
  rewritePercentage: number;
  differencePercentage: number;
  thresholdPercentage: number;
  dominantType: "new" | "rewrite" | null;
  isImbalanced: boolean;
  warningMessage: string | null;
}

export interface RoyaltyDashboardData {
  monthlyData: RoyaltyMonthlyDatum[];
  currentMonth: { month: number; year: number; totalAmount: number; totalArticles: number };
  budget: { budgetAmount: number; spent: number; remaining: number; percentage: number; hasBudget: boolean };
  topWriters: RoyaltyTopWriter[];
  contentBalance: RoyaltyContentBalance;
}
