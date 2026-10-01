"use client";

import { telegramUrl, whatsappUrl } from "@/lib/student-contact";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2a9.87 9.87 0 0 0-8.5 14.74L2 22l5.4-1.5A9.87 9.87 0 1 0 12.04 2Zm0 1.8a8.07 8.07 0 1 1-4.12 15.02l-.3-.18-3.06.85.86-2.98-.2-.31a8.07 8.07 0 0 1 6.82-12.4Zm-3.5 4.1c-.18 0-.47.07-.72.34-.24.27-.94.92-.94 2.24s.96 2.6 1.1 2.78c.13.18 1.88 3.03 4.65 4.06 2.3.86 2.77.69 3.27.65.5-.05 1.61-.66 1.84-1.3.22-.63.22-1.17.15-1.29-.06-.11-.24-.18-.5-.32-.27-.13-1.61-.79-1.86-.88-.25-.1-.43-.14-.61.14-.18.27-.7.88-.86 1.06-.16.18-.32.2-.59.07a7.5 7.5 0 0 1-2.2-1.36 8.2 8.2 0 0 1-1.52-1.89c-.16-.27-.02-.42.12-.55.12-.13.27-.32.4-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.13-.6-1.46-.83-1.99-.22-.52-.44-.45-.61-.46h-.52Z" />
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M21.9 4.6 2.7 12.1c-.66.26-.65 1.15.02 1.38l4.7 1.61 1.8 5.62c.24.75 1.2.86 1.65.22l2.6-3.73 4.9 3.6c.5.37 1.24.1 1.42-.5L22 5.9c.18-.7-.4-1.5-1.1-1.3ZM8.3 13.1l9.7-6.6c.16-.1.32.1.2.24l-8 7.28-.3 3.03-1.6-3.95Z" />
    </svg>
  );
}

/**
 * WhatsApp + Telegram direct-chat buttons for one student phone number.
 * Renders nothing when the number is missing/unusable.
 */
export default function StudentContactButtons({
  phone,
  size = "md",
}: {
  phone?: string | null;
  size?: "md" | "sm";
}) {
  const wa = whatsappUrl(phone);
  const tg = telegramUrl(phone);
  if (!wa && !tg) return null;
  const box =
    size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <span className="inline-flex items-center gap-1.5">
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          title="WhatsApp e message din"
          aria-label="WhatsApp e message din"
          className={`inline-flex ${box} items-center justify-center rounded-full bg-[#25D366]/15 text-[#1da851] transition hover:bg-[#25D366]/30 active:scale-95`}
        >
          <WhatsAppIcon className={icon} />
        </a>
      )}
      {tg && (
        <a
          href={tg}
          target="_blank"
          rel="noopener noreferrer"
          title="Telegram e message din"
          aria-label="Telegram e message din"
          className={`inline-flex ${box} items-center justify-center rounded-full bg-[#229ED9]/15 text-[#229ED9] transition hover:bg-[#229ED9]/30 active:scale-95`}
        >
          <TelegramIcon className={icon} />
        </a>
      )}
    </span>
  );
}
