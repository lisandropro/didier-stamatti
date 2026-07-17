"use client";

export function PrintButton() {
  return (
    <button className="btn primary no-print" onClick={() => window.print()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 8V3.5h10V8M7 17h10v3.5H7z" /><path d="M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5V16h-4M3 16h4M3 9.5A1.5 1.5 0 0 1 4.5 8" />
      </svg>
      Imprimir
    </button>
  );
}
