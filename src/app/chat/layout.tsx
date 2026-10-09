import React from "react";

// The chat route is a full-height messenger. The storefront shell pads its main
// (`px-4 py-8 sm:px-6 lg:px-8`), which previously pushed the h-dvh chat panel
// below the fold so the composer was off-screen. This layout cancels that
// padding and caps the height just under the sticky header (h-16 + safe top),
// turning /chat into a single, self-contained scroll container.
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-4 -my-8 h-[calc(100svh-4rem-var(--safe-top))] overflow-hidden bg-background sm:-mx-6 lg:-mx-8">
      {children}
    </div>
  );
}