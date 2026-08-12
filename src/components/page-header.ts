import { t, type Locale } from "../i18n";
import type { PageSourceId } from "../types";
import { iconMarkup } from "../utils/format";

export function renderPageSourceBadge(
  pageSourceId: PageSourceId,
  copiedPageSourceId: PageSourceId | null,
  locale: Locale
): string {
  const copied = copiedPageSourceId === pageSourceId;
  const copyLabel = copied ? t(locale, "pageSourceCopied") : t(locale, "copyPageSource");

  return `
    <div class="page-source-badge" aria-label="${t(locale, "pageSourceIdentifier")}">
      <span class="page-source-badge-label">${t(locale, "pageSourceIdentifier")}</span>
      <code class="page-source-badge-value" title="${pageSourceId}">${pageSourceId}</code>
      <button
        class="page-source-copy"
        type="button"
        data-page-source-copy="${pageSourceId}"
        aria-label="${copyLabel}"
        title="${copyLabel}"
      >
        ${iconMarkup(copied ? "check" : "copy", "page-source-copy-icon")}
      </button>
      <span class="sr-only" aria-live="polite">${copied ? t(locale, "pageSourceCopied") : ""}</span>
    </div>
  `;
}

export function renderPageHeader(
  icon: string,
  eyebrow: string,
  title: string,
  description: string,
  pageSourceId: PageSourceId,
  showPageSourceIds: boolean,
  copiedPageSourceId: PageSourceId | null,
  locale: Locale,
  actions = ""
): string {
  return `
    <header class="page-header">
      ${showPageSourceIds ? `<div class="page-header-source">${renderPageSourceBadge(pageSourceId, copiedPageSourceId, locale)}</div>` : ""}
      <div class="page-header-main">
        <div class="page-header-copy">
          <div class="page-kicker">${iconMarkup(icon, "page-kicker-icon")}<span>${eyebrow}</span></div>
          <h1>${title}</h1>
          <p>${description}</p>
        </div>
        ${actions ? `<div class="page-header-actions">${actions}</div>` : ""}
      </div>
    </header>
  `;
}
