export type Page = "dashboard" | "articles" | "tasks" | "team" | "royalty" | "notifications" | "audit" | "profile";

export interface Collaborator {
  id: number;
  name: string;
  penName: string;
  role: string;
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
}

export interface UserAccount {
  id: number;
  email: string;
  role: "admin" | "ctv";
  collaboratorId: number | null;
}

export interface Article {
  id: number;
  articleId: string;
  date: string;
  title: string;
  penName: string;
  createdByUserId?: number | null;
  category: string;
  articleType: string;
  contentType: string;
  wordCountRange: string;
  status: string;
  link: string;
  reviewerName: string;
  notes: string;
  canDelete?: boolean;
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
  details: Record<string, { count: number; unitPrice: number; total: number }> | null;
  status: "pending" | "approved" | "paid";
  approvedByUserId: number | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  isEstimated?: boolean;
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
  count: number;
}

export interface DashboardLatestArticle {
  articleId: string;
  title: string;
  penName: string;
  articleType: string;
  status: string;
  date: string;
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

export interface RoyaltyDashboardData {
  monthlyData: RoyaltyMonthlyDatum[];
  currentMonth: { month: number; year: number; totalAmount: number; totalArticles: number };
  budget: { budgetAmount: number; spent: number; percentage: number; hasBudget: boolean };
  topWriters: RoyaltyTopWriter[];
}
