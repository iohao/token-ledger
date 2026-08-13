import React from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import type { PageSourceId } from "../types";

export interface PageHeaderProps {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  pageSourceId: PageSourceId;
  actions?: React.ReactNode;
}

export const PageSourceBadge: React.FC<{ pageSourceId: PageSourceId }> = ({ pageSourceId }) => {
  const { t } = useTranslation();
  const { copiedPageSourceId, copyPageSourceId } = useApp();
  const isCopied = copiedPageSourceId === pageSourceId;
  const copyLabel = isCopied ? t("pageSourceCopied") : t("copyPageSource");

  return (
    <div className="page-source-badge" aria-label={t("pageSourceIdentifier")}>
      <span className="page-source-badge-label">{t("pageSourceIdentifier")}</span>
      <code className="page-source-badge-value" title={pageSourceId}>
        {pageSourceId}
      </code>
      <button
        className="page-source-copy"
        type="button"
        onClick={() => void copyPageSourceId(pageSourceId)}
        aria-label={copyLabel}
        title={copyLabel}
      >
        {isCopied ? (
          <Check className="page-source-copy-icon" size={14} aria-hidden="true" />
        ) : (
          <Copy className="page-source-copy-icon" size={14} aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {isCopied ? t("pageSourceCopied") : ""}
      </span>
    </div>
  );
};

export const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  eyebrow,
  title,
  description,
  pageSourceId,
  actions
}) => {
  const { showPageSourceIds } = useApp();

  return (
    <header className="page-header">
      {showPageSourceIds && (
        <div className="page-header-source">
          <PageSourceBadge pageSourceId={pageSourceId} />
        </div>
      )}
      <div className="page-header-main">
        <div className="page-header-copy">
          <div className="page-kicker">
            <span className="page-kicker-icon">{icon}</span>
            <span>{eyebrow}</span>
          </div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  );
};
