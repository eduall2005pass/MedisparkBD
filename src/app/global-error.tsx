"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-dark-950 p-8 text-center text-neutral-300">
        <h2 className="text-xl font-semibold text-heading">Something went wrong</h2>
        <p className="max-w-md text-sm text-neutral-400">
          {error?.message || "An unexpected error occurred. Please try again."}
        </p>
        <button
          onClick={() => reset()}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
