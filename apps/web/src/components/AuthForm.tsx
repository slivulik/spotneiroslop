"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { WaveLogo } from "@/components/icons";
import { Oscilloscope } from "@/components/visual/Sonic";
import { login, register, SessionError } from "@/lib/session";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Неверный e-mail или пароль",
  email_taken: "Аккаунт с таким e-mail уже есть",
  rate_limited: "Слишком много попыток. Подождите минуту",
  validation_error: "Проверьте поля: пароль — от 8 символов",
};

function safeNext(value: string | null): string {
  // Only same-site paths: never redirect to another origin after sign-in.
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, String(form.get("name") ?? ""));
      router.replace(next);
    } catch (e) {
      setError(e instanceof SessionError ? (MESSAGES[e.code] ?? e.message) : "Сервер недоступен");
    } finally {
      setPending(false);
    }
  };

  const field = "w-full rounded-md border border-border-default bg-white/5 px-4 py-3 text-body outline-none transition-colors placeholder:text-text-tertiary focus:border-text-secondary";
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <form onSubmit={onSubmit} className="liquid liquid-strong w-full max-w-sm rounded-[32px] p-8">
        <div className="mb-8 flex flex-col items-center gap-3">
          <WaveLogo size={44} />
          <span className="mono-label flex items-center gap-2 text-text-secondary"><span className="on-air-dot" /> Sonora · эфир</span>
          <h1 className="font-display text-title-1">{mode === "login" ? "Вход в Sonora" : "Новый аккаунт"}</h1>
          <Oscilloscope height={28} className="mt-1 opacity-80" />
        </div>
        <div className="flex flex-col gap-3">
          {mode === "register" ? <input name="name" required maxLength={64} placeholder="Имя" autoComplete="nickname" className={field} /> : null}
          <input name="email" type="email" required placeholder="E-mail" autoComplete="email" className={field} />
          <input
            name="password"
            type="password"
            required
            minLength={mode === "register" ? 8 : 1}
            placeholder="Пароль"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={field}
          />
        </div>
        {error ? <p role="alert" className="mt-4 text-caption text-state-danger">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-full bg-accent py-3 text-body font-bold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>
        <p className="mt-6 text-center text-caption text-text-secondary">
          {mode === "login" ? (
            <>
              Нет аккаунта? <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-text-primary hover:underline">Зарегистрироваться</Link>
            </>
          ) : (
            <>
              Уже есть аккаунт? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-text-primary hover:underline">Войти</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
