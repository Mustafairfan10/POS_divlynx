"use client";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

/**
 * Print any React node (receipt, ticket, report) through the browser print dialog.
 * Works with thermal printers (58/80mm roll, auto height), regular printers,
 * "Save as PDF", and on iOS/Android via the system print sheet.
 */
export function printNode(node: ReactNode, paper: "58" | "80" | "a4" = "80"): Promise<void> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    flushSync(() => root.render(node));
    const html = container.innerHTML;
    root.unmount();

    let host = document.getElementById("print-root");
    if (!host) {
      host = document.createElement("div");
      host.id = "print-root";
      document.body.appendChild(host);
    }
    host.innerHTML = html;

    let style = document.getElementById("print-page-style") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "print-page-style";
      document.head.appendChild(style);
    }
    style.textContent =
      paper === "a4" ? "@page { size: A4; margin: 14mm; }" : `@page { size: ${paper}mm auto; margin: 0; }`;

    document.body.classList.add("printing");
    const done = () => {
      document.body.classList.remove("printing");
      if (host) host.innerHTML = "";
      window.removeEventListener("afterprint", done);
      resolve();
    };
    window.addEventListener("afterprint", done);
    // Let the browser lay out the print DOM (and load fonts) first.
    requestAnimationFrame(() =>
      setTimeout(() => {
        window.print();
        // Some mobile browsers never fire afterprint.
        setTimeout(() => document.body.classList.contains("printing") && done(), 60_000);
      }, 60),
    );
  });
}
