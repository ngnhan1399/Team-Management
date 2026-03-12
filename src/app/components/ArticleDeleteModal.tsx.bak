"use client";

import React from "react";
import CustomSelect from "./CustomSelect";
import type { ArticleDeleteCriteria, ArticleDeletePreview, Collaborator } from "./types";

type SelectOption = { value: string; label: string };
type DeleteMode = "all" | "current_filters" | "custom";
type DeletePreset = "drafts_this_month" | "needs_fix" | "clear";

type ArticleDeleteModalProps = {
  deleteLoading: boolean;
  deleteExecuting: boolean;
  deleteError: string;
  deleteMode: DeleteMode;
  deleteCriteriaSummary: string[];
  deleteCriteria: ArticleDeleteCriteria;
  customDeleteCriteriaCount: number;
  collaboratorsLoading: boolean;
  collaborators: Collaborator[];
  articleStatusOptions: SelectOption[];
  articleTypeOptions: string[];
  contentTypeOptions: string[];
  monthOptions: SelectOption[];
  yearOptions: SelectOption[];
  deletePreview: ArticleDeletePreview | null;
  onClose: () => void;
  onDeleteModeChange: (mode: DeleteMode) => void;
  updateDeleteCriteria: (key: keyof ArticleDeleteCriteria, value: string) => void;
  applyDeletePreset: (preset: DeletePreset) => void;
  requestDeletePreview: () => void;
  executeDelete: () => void;
  statusBadge: (status: string) => React.ReactNode;
};

const DELETE_MODE_OPTIONS: Array<{
  mode: DeleteMode;
  icon: string;
  title: string;
  description: string;
}> = [
  {
    mode: "all",
    icon: "database",
    title: "Xóa toàn bộ",
    description: "Xóa toàn bộ dữ liệu bài viết hiện có.",
  },
  {
    mode: "current_filters",
    icon: "filter_alt",
    title: "Theo bộ lọc hiện tại",
    description: "Dùng chính bộ lọc và ô tìm kiếm đang mở ở trang danh sách.",
  },
  {
    mode: "custom",
    icon: "psychology_alt",
    title: "Xóa thông minh",
    description: "Xóa theo tiêu chí chi tiết như tên bài, bút danh, tháng, năm.",
  },
];

export default function ArticleDeleteModal({
  deleteLoading,
  deleteExecuting,
  deleteError,
  deleteMode,
  deleteCriteriaSummary,
  deleteCriteria,
  customDeleteCriteriaCount,
  collaboratorsLoading,
  collaborators,
  articleStatusOptions,
  articleTypeOptions,
  contentTypeOptions,
  monthOptions,
  yearOptions,
  deletePreview,
  onClose,
  onDeleteModeChange,
  updateDeleteCriteria,
  applyDeletePreset,
  requestDeletePreview,
  executeDelete,
  statusBadge,
}: ArticleDeleteModalProps) {
  const canClose = !deleteLoading && !deleteExecuting;

  return (
    <div className="modal-overlay" onClick={() => canClose && onClose()}>
      <div data-testid="article-delete-modal" className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1080, width: "94vw" }}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="material-symbols-outlined" style={{ color: "var(--danger)" }}>delete_sweep</span>
            Công cụ xóa bài viết thông minh
          </h3>
          <button className="modal-close" onClick={() => canClose && onClose()}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ padding: 16, borderRadius: 16, background: "rgba(239, 68, 68, 0.06)", border: "1px solid rgba(239, 68, 68, 0.14)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span className="material-symbols-outlined" style={{ color: "var(--danger)", fontSize: 20 }}>warning</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase" }}>Thao tác có tác động lớn</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.6 }}>
              Khi xóa bài viết, hệ thống cũng xóa comment, review, notification liên quan và reset toàn bộ dữ liệu nhuận bút để tránh lệch số liệu.
            </div>
          </div>

          {deleteError && (
            <div style={{ padding: 16, borderRadius: 16, background: "var(--danger-light)", border: "1px solid rgba(239, 68, 68, 0.18)", color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
              {deleteError}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12 }}>Phạm vi xóa</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {DELETE_MODE_OPTIONS.map((option) => {
                const active = deleteMode === option.mode;
                return (
                  <button
                    key={option.mode}
                    type="button"
                    data-testid={`article-delete-mode-${option.mode}`}
                    onClick={() => onDeleteModeChange(option.mode)}
                    style={{
                      textAlign: "left",
                      padding: 16,
                      borderRadius: 16,
                      border: active ? "1px solid rgba(239, 68, 68, 0.28)" : "1px solid var(--glass-border)",
                      background: active ? "rgba(239, 68, 68, 0.06)" : "rgba(255,255,255,0.5)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span className="material-symbols-outlined" style={{ color: active ? "var(--danger)" : "var(--text-muted)", fontSize: 20 }}>{option.icon}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main)" }}>{option.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{option.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {deleteMode === "all" && (
            <div style={{ padding: 18, borderRadius: 16, background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.16)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--danger)", marginBottom: 8 }}>Chế độ xóa toàn bộ đang bật</div>
              <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.6 }}>
                Hệ thống sẽ bỏ qua toàn bộ bộ lọc và xóa tất cả bài viết trong cơ sở dữ liệu. Chỉ nên dùng khi bạn thực sự muốn làm sạch dữ liệu để import lại từ đầu.
              </div>
            </div>
          )}

          {deleteMode === "current_filters" && (
            <div style={{ padding: 18, borderRadius: 16, background: "rgba(37, 99, 235, 0.05)", border: "1px solid rgba(37, 99, 235, 0.12)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--accent-blue)", marginBottom: 10 }}>Bộ lọc đang áp dụng</div>
              {deleteCriteriaSummary.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {deleteCriteriaSummary.map((item) => (
                    <span key={item} className="tag-pill">{item}</span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Hiện chưa có bộ lọc hoặc từ khóa tìm kiếm nào trên danh sách bài viết.
                </div>
              )}
            </div>
          )}

          {deleteMode === "custom" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Tiêu chí xóa thông minh</div>
                  <div style={{ fontSize: 13, color: "var(--text-main)" }}>Có thể kết hợp nhiều điều kiện như tên bài, bút danh, tháng/năm, trạng thái, loại bài.</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => applyDeletePreset("drafts_this_month")}>
                    Nháp tháng này
                  </button>
                  <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => applyDeletePreset("needs_fix")}>
                    Bài cần sửa
                  </button>
                  <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => applyDeletePreset("clear")}>
                    Xóa tiêu chí
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Tên bài viết</label>
                  <input
                    data-testid="article-delete-title-query"
                    className="form-input"
                    value={deleteCriteria.titleQuery}
                    onChange={(e) => updateDeleteCriteria("titleQuery", e.target.value)}
                    placeholder="Nhập một phần tiêu đề"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Tìm kiếm tổng quát</label>
                  <input
                    data-testid="article-delete-search"
                    className="form-input"
                    value={deleteCriteria.search}
                    onChange={(e) => updateDeleteCriteria("search", e.target.value)}
                    placeholder="Tiêu đề, mã bài, ghi chú..."
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Bút danh</label>
                  <CustomSelect
                    value={deleteCriteria.penName}
                    onChange={(value) => updateDeleteCriteria("penName", value)}
                    options={[{ value: "", label: collaboratorsLoading && collaborators.length === 0 ? "Đang tải bút danh..." : "Tất cả bút danh" }, ...collaborators.map((c) => ({ value: c.penName, label: c.penName }))]}
                    placeholder="Tất cả bút danh"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Người duyệt</label>
                  <input
                    data-testid="article-delete-reviewer"
                    className="form-input"
                    value={deleteCriteria.reviewerName}
                    onChange={(e) => updateDeleteCriteria("reviewerName", e.target.value)}
                    placeholder="Tên người duyệt"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Trạng thái</label>
                  <CustomSelect
                    value={deleteCriteria.status}
                    onChange={(value) => updateDeleteCriteria("status", value)}
                    options={articleStatusOptions}
                    placeholder="Tất cả"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Danh mục</label>
                  <input
                    className="form-input"
                    value={deleteCriteria.category}
                    onChange={(e) => updateDeleteCriteria("category", e.target.value)}
                    placeholder="Ví dụ: ICT, Gia dụng"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Loại bài</label>
                  <CustomSelect
                    value={deleteCriteria.articleType}
                    onChange={(value) => updateDeleteCriteria("articleType", value)}
                    options={[{ value: "", label: "Tất cả loại bài" }, ...articleTypeOptions.map((value) => ({ value, label: value }))]}
                    placeholder="Tất cả loại bài"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Loại nội dung</label>
                  <CustomSelect
                    value={deleteCriteria.contentType}
                    onChange={(value) => updateDeleteCriteria("contentType", value)}
                    options={[{ value: "", label: "Tất cả loại nội dung" }, ...contentTypeOptions.map((value) => ({ value, label: value }))]}
                    placeholder="Tất cả loại nội dung"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Tháng</label>
                  <CustomSelect
                    value={deleteCriteria.month}
                    onChange={(value) => updateDeleteCriteria("month", value)}
                    options={monthOptions}
                    placeholder="Tháng"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Năm</label>
                  <CustomSelect
                    value={deleteCriteria.year}
                    onChange={(value) => updateDeleteCriteria("year", value)}
                    options={yearOptions}
                    placeholder="Năm"
                  />
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 14, background: "rgba(0,0,0,0.02)", border: "1px solid var(--glass-border)", fontSize: 13, color: "var(--text-muted)" }}>
                {customDeleteCriteriaCount > 0 ? `Đang có ${customDeleteCriteriaCount} tiêu chí tùy chỉnh.` : "Chưa có tiêu chí nào. Hãy nhập ít nhất một điều kiện hoặc chuyển sang chế độ xóa toàn bộ."}
              </div>
            </>
          )}

          <div style={{ padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.5)", border: "1px solid var(--glass-border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Xem trước phạm vi xóa</div>
                <div style={{ fontSize: 13, color: "var(--text-main)" }}>Xem trước số bài, dữ liệu liên đới và mẫu bản ghi sẽ bị xóa.</div>
              </div>
              {deletePreview && (
                <span className="tag-pill" style={{ color: deletePreview.total > 0 ? "var(--danger)" : "var(--text-muted)" }}>
                  {deletePreview.total} bài khớp điều kiện
                </span>
              )}
            </div>

            {deletePreview ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
                  {[
                    { label: "Bài viết", value: deletePreview.total, color: "var(--danger)", icon: "article" },
                    { label: "Comment", value: deletePreview.related.comments, color: "var(--accent-blue)", icon: "forum" },
                    { label: "Review", value: deletePreview.related.reviews, color: "var(--accent-orange)", icon: "rate_review" },
                    { label: "Notification", value: deletePreview.related.notifications, color: "var(--accent-purple)", icon: "notifications" },
                    { label: "Payment reset", value: deletePreview.related.payments, color: "var(--text-main)", icon: "payments" },
                  ].map((item) => (
                    <div key={item.label} style={{ padding: 14, borderRadius: 14, background: "rgba(255,255,255,0.7)", border: "1px solid var(--glass-border)" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, color: item.color }}>{item.icon}</span>
                      <div style={{ fontSize: 24, fontWeight: 800, color: item.color, marginTop: 6 }}>{item.value}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                {deletePreview.sample.length > 0 ? (
                  <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--glass-border)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Ngày</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Tiêu đề</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Bút danh</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deletePreview.sample.map((item) => (
                          <tr key={item.id} style={{ borderTop: "1px solid var(--glass-border)" }}>
                            <td style={{ padding: "10px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{item.date}</td>
                            <td style={{ padding: "10px 12px", color: "var(--text-main)", fontWeight: 600, minWidth: 320 }}>{item.title}</td>
                            <td style={{ padding: "10px 12px", color: "var(--accent-blue)", fontWeight: 700 }}>{item.penName}</td>
                            <td style={{ padding: "10px 12px" }}>{statusBadge(item.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ padding: 20, borderRadius: 14, border: "1px dashed var(--glass-border)", color: "var(--text-muted)" }}>
                    Không có bài viết nào khớp điều kiện hiện tại.
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: 20, borderRadius: 14, border: "1px dashed var(--glass-border)", color: "var(--text-muted)" }}>
                Chưa xem trước. Hãy bấm `Xem trước phạm vi xóa` trước khi thực thi.
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ios-pill btn-ios-secondary" onClick={onClose} disabled={deleteExecuting}>
            Hủy
          </button>
          <button data-testid="article-delete-preview-trigger" className="btn-ios-pill btn-ios-secondary" onClick={requestDeletePreview} disabled={deleteLoading || deleteExecuting}>
            {deleteLoading ? (
              <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang phân tích...</>
            ) : (
              <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>preview</span> Xem trước phạm vi xóa</>
            )}
          </button>
          <button
            className="btn-ios-pill"
            data-testid="article-delete-confirm"
            onClick={executeDelete}
            disabled={deleteExecuting || deleteLoading || !deletePreview || deletePreview.total === 0}
            style={{ background: "rgba(239, 68, 68, 0.1)", color: "var(--danger)", border: "1px solid rgba(239, 68, 68, 0.18)" }}
          >
            {deleteExecuting ? (
              <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang xóa...</>
            ) : (
              <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_forever</span> Xóa dữ liệu đã xem trước</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
