"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { Button, ConfirmButton, Field, Input, Modal, PageTitle, Pager, Panel, Pill, SearchBar, Select, useDebounced } from "@/components/admin/ui";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";
import { useSession } from "@/lib/session";

type Row = S["AdminUserRow"];

function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function UsersPage() {
  const me = useSession((s) => s.user?.id);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [blocked, setBlocked] = useState("");
  const [offset, setOffset] = useState(0);
  const [blocking, setBlocking] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const debounced = useDebounced(q);
  const users = useQuery({
    queryKey: ["admin", "users", debounced, role, blocked, offset],
    placeholderData: keepPreviousData,
    queryFn: () => unwrap(api.GET("/v1/admin/users", { params: { query: { q: debounced || undefined, role: (role || undefined) as never, blocked: blocked === "" ? undefined : blocked === "yes", offset, limit: 50 } } })),
  });
  const patch = useAction(({ id, body }: { id: string; body: S["AdminUserPatch"] }) => unwrap(api.PATCH("/v1/admin/users/{user_id}", { params: { path: { user_id: id } }, body })), { success: "Сохранено", invalidate: [["admin", "users"]] });
  const signOut = useAction((id: string) => unwrap(api.POST("/v1/admin/users/{user_id}/sign-out", { params: { path: { user_id: id } } })), { success: "Сессии завершены" });
  const remove = useAction((id: string) => unwrap(api.DELETE("/v1/admin/users/{user_id}", { params: { path: { user_id: id } } })), { success: "Аккаунт удалён", invalidate: [["admin", "users"]] });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Пользователи" subtitle={users.data ? `${users.data.total} аккаунтов` : undefined} />
      <div className="flex flex-wrap gap-3">
        <SearchBar value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="E-mail или имя" />
        <Select className="!w-44" value={role} onChange={(e) => { setRole(e.target.value); setOffset(0); }} options={[{ value: "", label: "Все роли" }, { value: "admin", label: "Админы" }, { value: "user", label: "Слушатели" }]} />
        <Select className="!w-48" value={blocked} onChange={(e) => { setBlocked(e.target.value); setOffset(0); }} options={[{ value: "", label: "Все" }, { value: "no", label: "Активные" }, { value: "yes", label: "Заблокированные" }]} />
      </div>
      <Panel>
        <div className="flex flex-col">
          {users.data?.items.map((u, i) => (
            <motion.div key={u.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.015 }} className="flex flex-wrap items-center gap-3 rounded-lg p-3 hover:bg-white/[0.04]">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-caption font-bold ${u.blocked_at ? "bg-state-danger/30" : "bg-gradient-to-br from-wave-a to-wave-b"}`}>{u.display_name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-[180px] flex-1">
                <div className="flex items-center gap-2 truncate text-body font-semibold">
                  {u.display_name}
                  {u.role === "admin" ? <Pill tone="warn">Админ</Pill> : null}
                  {u.blocked_at ? <Pill tone="danger">Заблокирован</Pill> : null}
                  {u.id === me ? <Pill>Вы</Pill> : null}
                </div>
                <div className="truncate text-caption text-text-secondary">{u.email}{u.email_verified ? " ✓" : ""}{u.block_reason ? ` · ${u.block_reason}` : ""}</div>
              </div>
              <div className="hidden w-40 text-caption text-text-secondary md:block">Был: {when(u.last_seen_at)}</div>
              <div className="hidden w-40 whitespace-nowrap text-caption tabular-nums text-text-secondary md:block">{u.plays} прослуш. · {u.devices} устр.</div>
              {u.id !== me ? (
                <div className="flex flex-wrap gap-1">
                  <Button tone="ghost" onClick={() => patch.mutate({ id: u.id, body: { role: u.role === "admin" ? "user" : "admin" } })}>{u.role === "admin" ? "Снять админа" : "Сделать админом"}</Button>
                  {u.blocked_at ? (
                    <Button tone="ghost" onClick={() => patch.mutate({ id: u.id, body: { blocked: false } })}>Разблокировать</Button>
                  ) : (
                    <Button tone="ghost" onClick={() => { setBlocking(u); setReason(""); }}>Заблокировать</Button>
                  )}
                  <Button tone="ghost" onClick={() => signOut.mutate(u.id)}>Выйти везде</Button>
                  <ConfirmButton label="Удалить" tone="ghost" confirm={`Аккаунт ${u.email} и вся его история будут удалены.`} onConfirm={() => remove.mutate(u.id)} />
                </div>
              ) : null}
            </motion.div>
          ))}
        </div>
        {users.data ? <Pager offset={offset} limit={50} total={users.data.total} onChange={setOffset} /> : null}
      </Panel>
      <Modal open={blocking !== null} onClose={() => setBlocking(null)} title={`Заблокировать ${blocking?.display_name ?? ""}`}>
        <p className="mb-4 text-body text-text-secondary">Пользователь сразу потеряет доступ на всех устройствах и не сможет войти.</p>
        <Field label="Причина (увидит пользователь)"><Input value={reason} maxLength={256} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-6 flex justify-end gap-2">
          <Button tone="ghost" onClick={() => setBlocking(null)}>Отмена</Button>
          <Button tone="danger" onClick={() => { patch.mutate({ id: blocking!.id, body: { blocked: true, block_reason: reason || null } }); setBlocking(null); }}>Заблокировать</Button>
        </div>
      </Modal>
    </div>
  );
}
