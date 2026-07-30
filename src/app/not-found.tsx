import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="accent-gradient bg-clip-text text-7xl font-bold text-transparent">404</p>
      <h1 className="text-xl font-semibold text-content">Page not found</h1>
      <p className="max-w-sm text-sm text-content-muted">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link href="/chat" className="btn-primary mt-2 h-10 px-5">
        Back to chat
      </Link>
    </div>
  );
}
