import React from "react";
import { useTranslation } from "react-i18next";

export interface EmptyStateProps {
  title: string;
  description: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, description }) => {
  const { t } = useTranslation();

  return (
    <section className="empty-panel panel">
      <p className="eyebrow">{t("emptyStateEyebrow")}</p>
      <h3>{title}</h3>
      <p className="empty-copy">{description}</p>
    </section>
  );
};
