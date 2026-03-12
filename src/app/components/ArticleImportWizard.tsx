"use client";

import React from "react";
import CustomSelect from "./CustomSelect";
import type { ImportAnalyzeResult, ImportColumnAnalysis, ImportDryRunResult, ImportExecuteResult } from "./types";

type SelectOption = { value: string; label: string };
type ImportantFieldInsight = {
  field: string;
  label: string;
  mapped: boolean;
  columnLabel: string;
};

type Props = {
  importing: boolean;
  importStep: number;
  importFile: File | null;
  importAnalysis: ImportAnalyzeResult | null;
  importMapping: Record<string, string>;
  importSheetName: string;
  importHeaderRowNumber: number;
  replaceExistingImport: boolean;
  importError: string;
  importDryRun: ImportDryRunResult | null;
  importDryRunLoading: boolean;
  importResult: ImportExecuteResult | null;
  missingRequiredImportFields: string[];
  duplicateMappedFields: string[];
  mappedFields: string[];
  importantFieldInsights: ImportantFieldInsight[];
  mappedPreviewFields: SelectOption[];
  importFieldOptions: SelectOption[];
  onClose: () => void;
  onTriggerImportPicker: () => void;
  onSheetChange: (value: string) => Promise<void> | void;
  onHeaderRowChange: (value: string) => Promise<void> | void;
  onReplaceExistingChange: (checked: boolean) => void;
  onUpdateImportMapping: (columnKey: string, field: string) => void;
  onRunImportDryRun: () => void;
  onExecuteImport: () => void;
  resolveImportPreviewValue: (row: ImportAnalyzeResult["sampleRows"][number], field: string) => string;
};

const STEP_ITEMS = [
  { n: 1, label: "Tải file", icon: "cloud_upload" },
  { n: 2, label: "Xem trước & Mapping", icon: "table_chart" },
  { n: 3, label: "Kết quả", icon: "check_circle" },
] as const;

function SummaryCard({ label, value, color, icon }: { label: string; value: React.ReactNode; color: string; icon: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.65)", border: "1px solid var(--glass-border)" }}>
      <span className="material-symbols-outlined" style={{ fontSize: 22, color }}>{icon}</span>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

export default function ArticleImportWizard(props: Props) {
  const {
    importing,
    importStep,
    importFile,
    importAnalysis,
    importMapping,
    importSheetName,
    importHeaderRowNumber,
    replaceExistingImport,
    importError,
    importDryRun,
    importDryRunLoading,
    importResult,
    missingRequiredImportFields,
    duplicateMappedFields,
    mappedFields,
    importantFieldInsights,
    mappedPreviewFields,
    importFieldOptions,
    onClose,
    onTriggerImportPicker,
    onSheetChange,
    onHeaderRowChange,
    onReplaceExistingChange,
    onUpdateImportMapping,
    onRunImportDryRun,
    onExecuteImport,
    resolveImportPreviewValue,
  } = props;
  const canClose = !importing;

  return (
    <div className="modal-overlay" onClick={() => canClose && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1040, width: "92vw" }}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="material-symbols-outlined" style={{ color: "var(--accent-blue)" }}>upload_file</span>
            Import Excel nâng cao
          </h3>
          <button className="modal-close" onClick={() => canClose && onClose()}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--glass-border)" }}>
          {STEP_ITEMS.map((step) => (
            <div key={step.n} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 14, background: importStep >= step.n ? "rgba(37, 99, 235, 0.08)" : "rgba(0,0,0,0.02)", border: `1px solid ${importStep === step.n ? "var(--accent-blue)" : "var(--glass-border)"}` }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: importStep >= step.n ? "var(--accent-blue)" : "var(--text-muted)" }}>{importStep > step.n ? "check_circle" : step.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: importStep >= step.n ? "var(--accent-blue)" : "var(--text-muted)" }}>{step.label}</span>
            </div>
          ))}
        </div>

        <div className="modal-body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {importStep === 1 && (
            importFile ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 48, color: "var(--accent-blue)", animation: "glowPulse 2s infinite" }}>analytics</span>
                <p style={{ marginTop: 16, fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>Đang phân tích workbook...</p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Dò sheet, header, kiểu dữ liệu và gợi ý mapping tự động.</p>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: 48 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 48, color: "var(--accent-blue)" }}>upload_file</span>
                <p style={{ marginTop: 14, fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>Chọn file để bắt đầu import</p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Hỗ trợ `.xlsx`, `.xls`, `.csv`</p>
                <button className="btn-ios-pill btn-ios-primary" style={{ marginTop: 20 }} onClick={onTriggerImportPicker}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>folder_open</span>
                  Chọn file
                </button>
              </div>
            )
          )}

          {importStep === 2 && importAnalysis && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 20 }}>
                <SummaryCard label="File" value={importFile?.name || "—"} color="var(--accent-blue)" icon="description" />
                <SummaryCard label="Dòng dữ liệu" value={importAnalysis.dataRowCount} color="var(--text-main)" icon="dataset" />
                <SummaryCard label="Header" value={`Dòng ${importAnalysis.headerRowNumber}`} color="var(--accent-orange)" icon="view_headline" />
                <SummaryCard label="Ánh xạ" value={`${mappedFields.length}/${importAnalysis.columns.length}`} color="var(--accent-teal)" icon="rule" />
              </div>

              <div style={{ marginBottom: 20, padding: 14, borderRadius: 14, background: "rgba(59, 130, 246, 0.06)", border: "1px solid rgba(59, 130, 246, 0.14)" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-blue)", textTransform: "uppercase", marginBottom: 8 }}>Hướng dẫn nhanh</div>
                <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.6 }}>
                  1) Chọn đúng `Sheet` và `Dòng header`.
                  <br />
                  2) Kiểm tra các trường quan trọng bên dưới: `Mã bài viết`, `Ngày viết`, `Tiêu đề`, `Bút danh`, `Trạng thái`, `Link bài viết`.
                  <br />
                  3) Nếu file có cả `STT` và `ID bài viết`, hãy map `STT` thành `— Bỏ qua —`, còn `ID bài viết` map vào `Mã bài viết`.
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>Trường quan trọng cần kiểm tra</h4>
                  <span className="tag-pill" style={{ fontSize: 11 }}>
                    {importantFieldInsights.filter((item) => item.mapped).length}/{importantFieldInsights.length} đã map
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  {importantFieldInsights.map((item) => (
                    <div key={item.field} style={{ padding: 12, borderRadius: 12, border: `1px solid ${item.mapped ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`, background: item.mapped ? "rgba(16, 185, 129, 0.06)" : "rgba(239, 68, 68, 0.05)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-main)" }}>{item.label}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, color: item.mapped ? "#10b981" : "var(--danger)", textTransform: "uppercase" }}>
                          {item.mapped ? "Đã map" : "Chưa map"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.columnLabel}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Sheet dữ liệu</label>
                  <CustomSelect
                    value={importSheetName}
                    onChange={onSheetChange}
                    options={importAnalysis.sheets.map((sheet) => ({ value: sheet.name, label: `${sheet.name} (${sheet.totalRows} dòng${sheet.isHidden ? ", ẩn" : ""})` }))}
                    placeholder="Chọn sheet"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Dòng header</label>
                  <CustomSelect
                    value={String(importHeaderRowNumber)}
                    onChange={onHeaderRowChange}
                    options={importAnalysis.headerCandidates.map((candidate) => ({ value: String(candidate.rowNumber), label: `Dòng ${candidate.rowNumber} • score ${candidate.score}` }))}
                    placeholder="Chọn dòng header"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0, display: "flex", alignItems: "flex-end" }}>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 14, borderRadius: 14, border: "1px solid rgba(239, 68, 68, 0.16)", background: "rgba(239, 68, 68, 0.04)", width: "100%", cursor: "pointer" }}>
                    <input type="checkbox" checked={replaceExistingImport} onChange={(e) => onReplaceExistingChange(e.target.checked)} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>Thay thế toàn bộ dữ liệu bài viết cũ</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Nếu bật, hệ thống sẽ dọn dữ liệu bài viết cũ trước khi nhập.</div>
                    </div>
                  </label>
                </div>
              </div>

              {importAnalysis.warnings.length > 0 && (
                <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, background: "rgba(249, 115, 22, 0.06)", border: "1px solid rgba(249, 115, 22, 0.14)" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-orange)", textTransform: "uppercase", marginBottom: 10 }}>Cảnh báo phân tích</div>
                  {importAnalysis.warnings.map((warning, index) => (
                    <div key={index} style={{ fontSize: 13, color: "var(--text-main)", marginBottom: index === importAnalysis.warnings.length - 1 ? 0 : 8 }}>• {warning}</div>
                  ))}
                </div>
              )}

              {importError && (
                <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, background: "var(--danger-light)", border: "1px solid rgba(239, 68, 68, 0.18)", color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
                  {importError}
                </div>
              )}

              {(missingRequiredImportFields.length > 0 || duplicateMappedFields.length > 0) && (
                <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, background: "rgba(239, 68, 68, 0.06)", border: "1px solid rgba(239, 68, 68, 0.14)" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase", marginBottom: 10 }}>Cần xử lý trước khi import</div>
                  {missingRequiredImportFields.length > 0 && <div style={{ fontSize: 13, color: "var(--text-main)", marginBottom: duplicateMappedFields.length > 0 ? 8 : 0 }}>• Thiếu trường bắt buộc: {missingRequiredImportFields.join(", ")}</div>}
                  {duplicateMappedFields.length > 0 && <div style={{ fontSize: 13, color: "var(--text-main)" }}>• Có trường đang bị map trùng: {Array.from(new Set(duplicateMappedFields)).join(", ")}</div>}
                </div>
              )}

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <h4 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>Ánh xạ cột chi tiết</h4>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Sheet `{importAnalysis.sheetName}` có {importAnalysis.totalRows} dòng vật lý.</p>
                  </div>
                  <span className="tag-pill" style={{ fontSize: 11 }}>{mappedFields.length}/{importAnalysis.columns.length} cột đã ánh xạ</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {importAnalysis.columns.map((column: ImportColumnAnalysis) => (
                    <div key={column.key} style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1.2fr) minmax(220px, 0.9fr) minmax(260px, 1.1fr)", gap: 16, padding: 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)" }}>
                      <div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                          <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(37, 99, 235, 0.08)", color: "var(--accent-blue)", fontSize: 11, fontWeight: 800 }}>{column.letter}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{column.header}</span>
                          <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(15, 23, 42, 0.05)", color: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}>{column.inferredType}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{column.sampleValues.length > 0 ? column.sampleValues.join(" • ") : "Không có mẫu dữ liệu"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Gợi ý tốt nhất</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {column.suggestions.slice(0, 3).map((suggestion) => (
                            <div key={`${column.key}-${suggestion.field}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                              <span style={{ color: suggestion.field === column.suggestedField ? "var(--accent-blue)" : "var(--text-main)", fontWeight: suggestion.field === column.suggestedField ? 700 : 500 }}>{importFieldOptions.find((option) => option.value === suggestion.field)?.label || suggestion.field}</span>
                              <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>score {suggestion.score}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Map vào trường hệ thống</div>
                        <CustomSelect value={importMapping[column.key] || ""} onChange={(value) => onUpdateImportMapping(column.key, value)} options={importFieldOptions} placeholder="Chọn trường..." />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>rule</span>
                    Preview dữ liệu chuẩn hóa trước khi nhập
                  </h4>
                  <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "8px 14px" }} onClick={onRunImportDryRun} disabled={importDryRunLoading || importing || missingRequiredImportFields.length > 0 || duplicateMappedFields.length > 0}>
                    {importDryRunLoading ? <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang tạo preview...</> : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>preview</span> Phân tích preview nhập</>}
                  </button>
                </div>

                {!importDryRun ? (
                  <div style={{ padding: 16, borderRadius: 14, border: "1px dashed var(--glass-border)", color: "var(--text-muted)", fontSize: 13 }}>
                    Bấm <strong>`Phân tích preview nhập`</strong> để xem chính xác dòng nào được nhập, trùng lặp, hoặc bị bỏ qua.
                  </div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
                      <SummaryCard label="Tổng dòng" value={importDryRun.total} color="var(--text-main)" icon="description" />
                      <SummaryCard label="Có thể nhập" value={importDryRun.importable} color="#10b981" icon="check_circle" />
                      <SummaryCard label="Trùng lặp" value={importDryRun.duplicates} color="var(--accent-orange)" icon="content_copy" />
                      <SummaryCard label="Bị bỏ qua" value={importDryRun.skipped} color="var(--danger)" icon="skip_next" />
                    </div>
                    <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--glass-border)" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Dòng</th>
                            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>ID bài</th>
                            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Ngày</th>
                            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Tiêu đề</th>
                            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Bút danh</th>
                            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Trạng thái</th>
                            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Kết quả</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importDryRun.previewRows.map((row) => (
                            <tr key={`dryrun-${row.rowNumber}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                              <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontWeight: 700 }}>#{row.rowNumber}</td>
                              <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>{row.normalized.articleId || "—"}</td>
                              <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>{row.normalized.date || "—"}</td>
                              <td style={{ padding: "10px 12px", color: "var(--text-main)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.normalized.title || "—"}</td>
                              <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>{row.normalized.penName || "—"}</td>
                              <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>{row.normalized.status || "—"}</td>
                              <td style={{ padding: "10px 12px", color: row.canImport ? "#10b981" : row.duplicate ? "var(--accent-orange)" : "var(--danger)", fontWeight: 700 }}>
                                {row.canImport ? "Sẽ nhập" : row.duplicate ? "Trùng lặp" : "Bỏ qua"}
                                {row.issues.length > 0 && <div style={{ marginTop: 4, color: "var(--text-muted)", fontWeight: 500, maxWidth: 320 }}>{row.issues.join("; ")}</div>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              <div style={{ marginTop: 24 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 12 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>preview</span>
                  Preview sau khi mapping
                </h4>
                {mappedPreviewFields.length === 0 ? (
                  <div style={{ padding: 20, borderRadius: 14, border: "1px dashed var(--glass-border)", color: "var(--text-muted)" }}>Chọn ít nhất một cột để xem preview.</div>
                ) : (
                  <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--glass-border)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                          <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Dòng</th>
                          {mappedPreviewFields.map((field) => (
                            <th key={field.value} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>{field.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importAnalysis.sampleRows.map((row) => (
                          <tr key={row.rowNumber} style={{ borderTop: "1px solid var(--glass-border)" }}>
                            <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontWeight: 700 }}>#{row.rowNumber}</td>
                            {mappedPreviewFields.map((field) => (
                              <td key={`${row.rowNumber}-${field.value}`} style={{ padding: "10px 12px", color: "var(--text-main)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {resolveImportPreviewValue(row, field.value)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 24 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 12 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>table_chart</span>
                  Mẫu dữ liệu gốc theo cột đã phân tích
                </h4>
                <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--glass-border)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                        <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Dòng</th>
                        {importAnalysis.columns.map((column) => (
                          <th key={column.key} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", minWidth: 150 }}>
                            {column.letter} • {column.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importAnalysis.sampleRows.map((row) => (
                        <tr key={`raw-${row.rowNumber}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontWeight: 700 }}>#{row.rowNumber}</td>
                          {importAnalysis.columns.map((column) => (
                            <td key={`${row.rowNumber}-${column.key}`} style={{ padding: "10px 12px", color: "var(--text-main)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {row.values[column.key] || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {importStep === 3 && importResult && (
            <div style={{ textAlign: "center", padding: 32 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 56, color: "var(--accent-teal)" }}>task_alt</span>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-main)", marginTop: 16 }}>Import hoàn tất!</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 24 }}>
                <SummaryCard label="Tổng dòng" value={importResult.total} color="var(--text-main)" icon="description" />
                <SummaryCard label="Đã nhập" value={importResult.imported} color="var(--accent-teal)" icon="check_circle" />
                <SummaryCard label="Trùng lặp" value={importResult.duplicates || 0} color="var(--accent-orange)" icon="content_copy" />
                <SummaryCard label="Bỏ qua" value={importResult.skipped} color="var(--text-muted)" icon="skip_next" />
              </div>
              <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, textAlign: "left" }}>
                <div style={{ padding: 14, borderRadius: 14, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Sheet</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{importResult.sheetName || importSheetName}</div>
                </div>
                <div style={{ padding: 14, borderRadius: 14, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Header</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>Dòng {importResult.headerRowNumber || importHeaderRowNumber}</div>
                </div>
                <div style={{ padding: 14, borderRadius: 14, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Chế độ</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{importResult.clearedExisting ? "Đã thay thế dữ liệu cũ" : "Chỉ thêm dữ liệu mới"}</div>
                </div>
              </div>
              {importResult.warnings?.length ? (
                <div style={{ marginTop: 24, textAlign: "left", padding: 16, borderRadius: 14, background: "rgba(249, 115, 22, 0.05)", border: "1px solid rgba(249, 115, 22, 0.15)" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-orange)", marginBottom: 8 }}>Cảnh báo còn lại</div>
                  {importResult.warnings.map((warning, index) => <div key={index} style={{ fontSize: 12, color: "var(--text-main)", marginBottom: index === importResult.warnings!.length - 1 ? 0 : 4 }}>• {warning}</div>)}
                </div>
              ) : null}
              {importResult.errors?.length > 0 && (
                <div style={{ marginTop: 24, textAlign: "left", padding: 16, borderRadius: 14, background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#ef4444", marginBottom: 8 }}>⚠️ Lỗi chi tiết:</div>
                  {importResult.errors.map((err, index) => <div key={index} style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>• {err}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {importStep === 1 && !importFile && (
            <>
              <button className="btn-ios-pill btn-ios-secondary" onClick={onClose}>Đóng</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={onTriggerImportPicker}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>folder_open</span> Chọn file
              </button>
            </>
          )}
          {importStep === 2 && (
            <>
              <button className="btn-ios-pill btn-ios-secondary" onClick={onClose}>Hủy bỏ</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={onExecuteImport} disabled={importing || missingRequiredImportFields.length > 0 || duplicateMappedFields.length > 0}>
                {importing ? <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang nhập...</> : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>file_download</span> Xác nhận nhập {importAnalysis?.dataRowCount} dòng</>}
              </button>
            </>
          )}
          {importStep === 3 && importResult && (
            <button className="btn-ios-pill btn-ios-primary" onClick={onClose}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>done</span> Hoàn tất
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
