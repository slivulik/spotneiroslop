import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="font-display text-display-l">404</div>
      <p className="text-body-l text-text-secondary">Такой страницы нет.</p>
      <Link href="/" className="rounded-full bg-text-primary px-5 py-2 text-caption font-bold text-bg-base">
        На главную
      </Link>
    </div>
  );
}
