"use client";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { env } from "../env.mjs";
import type { TransactionResult } from "../lib/transaction-feedback";

export function TransactionResultModal({
  result,
  onClose,
}: {
  result: TransactionResult | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId(),
    descriptionId = useId();
  useEffect(() => {
    if (!result || !dialog.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current.showModal();
    return () => {
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [result]);
  if (!result) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="transaction-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={onClose}
    >
      <div className="transaction-dialog-header">
        <span
          className={`transaction-result-icon ${result.status}`}
          aria-hidden="true"
        >
          {result.status === "success" ? (
            <CheckCircle2 size={28} />
          ) : (
            <CircleAlert size={28} />
          )}
        </span>
        <button
          className="dialog-close"
          aria-label="Close transaction result"
          onClick={onClose}
          autoFocus
        >
          <X size={20} />
        </button>
      </div>
      <div>
        <span className="app-eyebrow">Transaction details</span>
        <h2 id={titleId}>{result.title}</h2>
      </div>
      <p id={descriptionId}>{result.description}</p>
      {result.hash ? (
        <div className="transaction-proof">
          <span>{result.transactionLabel ?? "Transaction hash"}</span>
          <code>{result.hash}</code>
          <a
            className="text-action"
            target="_blank"
            rel="noopener noreferrer"
            href={`${env.EXPLORER_URL.replace(/\/$/, "")}/tx/${result.hash}`}
          >
            View transaction on explorer ↗
          </a>
        </div>
      ) : (
        <p className="transaction-proof">
          No transaction hash was received for this request.
        </p>
      )}
      <button className="app-button" onClick={onClose}>
        Back to workspace
      </button>
    </dialog>,
    document.body,
  );
}
