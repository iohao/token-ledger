import React from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { formatByteCount, formatTimestamp } from "../utils/format";
import { translateErrorMessage, type Locale } from "../i18n";
import type { InlineNoticeTone, UpdateStatus } from "../types";

export const isMacOS = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

export function updateStatusMessage(
  status: UpdateStatus,
  version: string | undefined,
  downloadedBytes: number,
  contentLength: number | null,
  errorMsg: string | null,
  locale: Locale,
  t: (key: any, params?: any) => string
): string {
  if (status === "error" && errorMsg) {
    return errorMsg;
  }

  if (status === "checking") {
    return t("checkingForUpdates");
  }

  if (status === "available" && version) {
    return t("updateAvailableStatus", { version });
  }

  if (status === "upToDate") {
    return t("updateIsCurrent");
  }

  if (status === "installing") {
    if (contentLength && contentLength > 0) {
      return t("updateDownloadProgress", {
        downloaded: formatByteCount(downloadedBytes, locale),
        total: formatByteCount(contentLength, locale)
      });
    }
    return t("installingUpdate");
  }

  return t("updateChecksRunOnLaunch");
}

export function updatePlatformSupportNote(locale: Locale): string | null {
  if (!isMacOS) {
    return null;
  }
  return locale === "zh-CN"
    ? "当前 macOS 安装包尚未做 Apple 签名与公证。检查更新通常仍可命中，但下载后的新版本可能被系统拦截，首次打开时可能需要手动移除 quarantine 或再次放行。"
    : "This macOS app is not yet signed and notarized by Apple. Update checks can still succeed, but the downloaded replacement app may be blocked by macOS on first launch.";
}

export function decorateUpdateErrorMessage(message: string, locale: Locale): string {
  const translated = translateErrorMessage(locale, message);
  if (!isMacOS) {
    return translated;
  }
  return `${translated} ${
    locale === "zh-CN"
      ? "如果你运行的是未签名的 macOS 应用包，系统可能会拦截更新后的新版本。请优先用 GitHub Release 的正式安装包测试，或在替换后手动移除 quarantine。"
      : "If you are running an unsigned macOS app bundle, macOS may block the updated app after replacement. Test with the GitHub Release install package first, or remove quarantine manually after update."
  }`;
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

export const UpdateNotes: React.FC<{ notes: string | null | undefined }> = ({ notes }) => {
  const { t } = useTranslation();
  if (!notes) {
    return null;
  }

  return (
    <div className="update-notes">
      <p className="eyebrow">{t("updateReleaseNotes")}</p>
      <p className="update-notes-copy" dangerouslySetInnerHTML={{ __html: notes.replaceAll("\n", "<br />") }} />
    </div>
  );
};

export const UpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const { availableUpdate, isInstallingUpdate, isLoading, isSyncing, installAppUpdate, dashboard, locale } = useApp();

  if (!availableUpdate) {
    return null;
  }

  const installDisabled = isInstallingUpdate || isLoading || isSyncing;
  const timeZone = dashboard?.meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const publishedAt = availableUpdate.date ? formatTimestamp(availableUpdate.date, timeZone, locale) : "-";

  return (
    <section className="banner good update-banner">
      <div>
        <strong>{t("updateAvailableBanner", { version: availableUpdate.version })}</strong>
        <p>{t("updatePublishedAt", { value: publishedAt })}</p>
      </div>
      <button
        className="action primary"
        type="button"
        onClick={() => void installAppUpdate()}
        disabled={installDisabled}
      >
        {isInstallingUpdate ? t("installingUpdate") : t("downloadAndInstallUpdate")}
      </button>
    </section>
  );
};
