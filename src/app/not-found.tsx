import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-2xl font-semibold text-white">Page not found</h2>
      <p className="max-w-md text-sm text-neutral-400">
        The page you are looking for does not exist or was moved.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
      >
        Go back home
      </Link>
    </main>
  );
}
