import React, { useEffect, useRef } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  titleId = "modal-title",
  children,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;

      // Focus first focusable element inside modal
      const timer = setTimeout(() => {
        if (modalRef.current) {
          const focusable = modalRef.current.querySelector<HTMLElement>(
            'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable) {
            focusable.focus();
          } else {
            modalRef.current.focus();
          }
        }
      }, 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
          return;
        }

        if (e.key === "Tab" && modalRef.current) {
          const focusables = modalRef.current.querySelectorAll<HTMLElement>(
            'input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
          );
          if (focusables.length === 0) return;

          const first = focusables[0];
          const last = focusables[focusables.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };

      document.addEventListener("keydown", handleKeyDown);

      return () => {
        clearTimeout(timer);
        document.removeEventListener("keydown", handleKeyDown);
        if (triggerRef.current && typeof triggerRef.current.focus === "function") {
          triggerRef.current.focus();
        }
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
};
