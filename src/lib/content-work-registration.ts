const CONTENT_WORK_REGISTRATION_TITLE = "Đăng ký lại bài trong Content Work";
const CONTENT_WORK_REGISTRATION_URL = "https://docs.google.com/forms/d/1CRpmylyRwSo1tpc5Xa_ryVy2m_c2xTjXb9t_ESihGdY/viewform?edit_requested=true";

function normalizeRegistrationReminderText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isContentWorkRegistrationReminderTitle(value: unknown) {
  return normalizeRegistrationReminderText(value) === normalizeRegistrationReminderText(CONTENT_WORK_REGISTRATION_TITLE);
}

export { CONTENT_WORK_REGISTRATION_TITLE, CONTENT_WORK_REGISTRATION_URL };
