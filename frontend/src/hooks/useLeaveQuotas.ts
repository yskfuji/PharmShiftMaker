"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LeaveQuotaKind, LeaveQuotaRecord } from "@/lib/types";

import { API_BASE_URL } from "@/lib/apiTarget";

interface LeaveQuotaApiResponse {
  year: number;
  month: number;
  items: Array<{
    person_id: string;
    person_name: string | null;
    year: number;
    month: number;
    kind: LeaveQuotaKind;
    total_days: number;
    used_days: number;
    used_before_month: number;
    remaining_days: number;
  }>;
}

interface UseLeaveQuotasResult {
  items: LeaveQuotaRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (personId: string, kind: LeaveQuotaKind, totalDays: number) => Promise<void>;
  remove: (personId: string, kind: LeaveQuotaKind) => Promise<void>;
}

export default function useLeaveQuotas(year: number, month: number): UseLeaveQuotasResult {
  const request = useRef<AbortController|null>(null);
  const [receivedFor, setReceivedFor] = useState('');
  const [items, setItems] = useState<LeaveQuotaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const endpoint = useMemo(
    () => `${API_BASE_URL}/leave-quotas?year=${year}&month=${month}`,
    [year, month],
  );

  const fetchItems = useCallback(async () => {
    request.current?.abort();
    const controller=new AbortController(); request.current=controller;
    setItems([]); setReceivedFor('');
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "include", signal:controller.signal });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "休暇クォータの取得に失敗しました");
      }
      const payload = (await response.json()) as LeaveQuotaApiResponse;
      const mapped: LeaveQuotaRecord[] = payload.items.map((item) => ({
        personId: item.person_id,
        personName: item.person_name,
        year: item.year,
        month: item.month,
        kind: item.kind,
        totalDays: item.total_days,
        usedDays: item.used_days,
        usedBeforeMonth: item.used_before_month,
        remainingDays: item.remaining_days,
      }));
      if(controller.signal.aborted)return;
      if(payload.year!==year||payload.month!==month)throw new Error("取得した休暇枠の年月が一致しません。");
      setItems(mapped); setReceivedFor(endpoint);
    } catch (err) {
      if(controller.signal.aborted)return;
      setReceivedFor(endpoint); setItems([]);
      setError(err instanceof Error ? err.message : "休暇クォータの取得に失敗しました");
    } finally {
      if(!controller.signal.aborted)setLoading(false);
    }
  }, [endpoint,year,month]);

  useEffect(() => {
    void fetchItems();
    return ()=>request.current?.abort();
  }, [fetchItems]);

  const upsert = useCallback(
    async (personId: string, kind: LeaveQuotaKind, totalDays: number) => {
      const url = `${API_BASE_URL}/leave-quotas/${year}/${personId}/${kind}?month=${month}`;
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_days: totalDays }),
        credentials: "include",
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "休暇クォータの更新に失敗しました");
      }
      await fetchItems();
    },
    [fetchItems, month, year],
  );

  const remove = useCallback(
    async (personId: string, kind: LeaveQuotaKind) => {
      const url = `${API_BASE_URL}/leave-quotas/${year}/${personId}/${kind}`;
      const response = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "休暇クォータの削除に失敗しました");
      }
      await fetchItems();
    },
    [fetchItems, year],
  );

  return { items:receivedFor===endpoint?items:[], loading:loading||receivedFor!==endpoint, error:receivedFor===endpoint?error:null, refresh: fetchItems, upsert, remove };
}
