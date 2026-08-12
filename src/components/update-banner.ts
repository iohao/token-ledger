import { t, type Locale, translateErrorMessage } from "../i18n";
import type { AppState, InlineNoticeTone, UpdateStatus } from "../types";
import { escapeHtml, formatByteCount, formatTimestamp } from "../utils/format";

export const isMacOS = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

export function updateStatusMessage(state: AppState): string {
  if (state.updateStatus === "error" && state.updateErrorMessage) {
    return state.updateErrorMessage;
  }

  if (state.updateStatus === "checking") {
    return t(state.locale, "checkingForUpdates");
  }

  if (state.updateStatus === "available" && state.availableUpdate) {
    return t(state.locale, "updateAvailableStatus", {
      version: state.availableUpdate.version
    });
  }

  if (state.updateStatus === "upToDate") {
    return t(state.locale, "updateIsCurrent");
  }

  if (state.updateStatus === "installing") {
    if (state.updateContentLength && state.updateContentLength > 0) {
      return t(state.locale, "updateDownloadProgress", {
        downloaded: formatByteCount(state.updateDownloadedBytes, state.locale),
        total: formatByteCount(state.updateContentLength, state.locale)
      });
    }

    return t(state.locale, "installingUpdate");
  }

  return t(state.locale, "updateChecksRunOnLaunch");
}

export function updatePlatformSupportNote(locale: Locale): string | null {
  if (!isMacOS) {
    return null;
  }

  return t(locale, "updateMacUnsignedHint");
}

export function decorateUpdateErrorMessage(message: string, locale: Locale): string {
  const translated = translateErrorMessage(locale, message);

  if (!isMacOS) {
    return translated;
  }

  return `${translated} ${t(locale, "updateMacUnsignedErrorHint")}`;
}

export function updateStatusTone(updateStatus: UpdateStatus): InlineNoticeTone | null {
  if (updateStatus === "available" || updateStatus === "upToDate") {
    return "good";
  }

  if (updateStatus === "error") {
    return "bad";
  }

  return null;
}

export function renderUpdateBanner(state: AppState, timeZone: string): string {
  if (!state.availableUpdate) {
    return "";
  }

  const installDisabled = state.isInstallingUpdate || state.isLoading || state.isSyncing;
  const publishedAt = state.availableUpdate.date ? formatTimestamp(state.availableUpdate.date, timeZone, state.locale) : "-";

  return `
    <section class="banner good update-banner">
      <div>
        <strong>${t(state.locale, "updateAvailableBanner", { version: state.availableUpdate.version })}</strong>
        <p>${t(state.locale, "updatePublishedAt", { value: publishedAt })}</p>
      </div>
      <button class="action primary" type="button" data-install-update ${installDisabled ? "disabled" : ""}>
        ${state.isInstallingUpdate ? t(state.locale, "installingUpdate") : t(state.locale, "downloadAndInstallUpdate")}
      </button>
    </section>
  `;
}

export function renderUpdateNotes(notes: string | null | undefined, locale: Locale): string {
  if (!notes) {
    return "";
  }

  return `
    <div class="update-notes">
      <p class="eyebrow">${t(locale, "updateReleaseNotes")}</p>
      <p class="update-notes-copy">${escapeHtml(notes).replaceAll("\n", "<br />")}</p>
    </div>
  `;
}
