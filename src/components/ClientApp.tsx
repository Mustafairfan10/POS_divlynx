"use client";
import dynamic from "next/dynamic";

// The POS is a local-first client app (IndexedDB, service worker): render it only in the browser.
const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-4 border-line border-t-brand" />
    </div>
  ),
});

export default function ClientApp() {
  return <App />;
}
