import { t, type Locale } from "../i18n";

export function renderEmptyState(title: string, description: string, locale: Locale): string {
  return `
    <section class="empty-panel panel">
      <p class="eyebrow">${t(locale, "emptyStateEyebrow")}</p>
      <h3>${title}</h3>
      <p class="empty-copy">${description}</p>
    </section>
  `;
}
