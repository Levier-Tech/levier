import type { ReactNode } from "react";
import Link from "next/link";

export function AppPage({
  eyebrow,
  title,
  description,
  children,
  back,
  backHref = "/markets",
  backLabel = "← All markets",
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  back?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="app-page">
      {back && (
        <Link className="app-back" href={backHref}>
          {backLabel}
        </Link>
      )}
      <header className="app-page-heading">
        <span className="app-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="app-page-content">{children}</div>
    </div>
  );
}

export function DataState({
  title,
  children,
  retry,
}: {
  title: string;
  children: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="data-state" role="status">
      <h2>{title}</h2>
      <p>{children}</p>
      {retry && (
        <button className="app-button secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
