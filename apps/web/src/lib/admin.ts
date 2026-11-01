"use client";

import type { components } from "@sonora/api-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorText, toast } from "@/components/admin/ui";
import { api, unwrap } from "@/lib/api";

export type S = components["schemas"];

export function useStats() {
  return useQuery({ queryKey: ["admin", "stats"], queryFn: () => unwrap(api.GET("/v1/admin/stats")), refetchInterval: 15_000 });
}

export function useStreaming() {
  return useQuery({ queryKey: ["admin", "streaming"], queryFn: () => unwrap(api.GET("/v1/admin/streaming")), refetchInterval: 5_000 });
}

export function usePlatformConfig() {
  return useQuery({ queryKey: ["admin", "platform"], queryFn: () => unwrap(api.GET("/v1/admin/platform")) });
}

/** Mutation with a success toast, error toast and cache invalidation. */
export function useAction<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  { success, invalidate = [["admin"]] }: { success?: string; invalidate?: unknown[][] } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      if (success) toast(success);
      await Promise.all(invalidate.map((key) => client.invalidateQueries({ queryKey: key })));
      await client.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => toast(errorText(e), "error"),
  });
}
