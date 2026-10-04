"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {getLegacyClientContext} from '@/lib/auth-client';
import {useIdentity} from "@/components/IdentityProvider";
import { HolidayRequestKind, HolidayRequestRecord } from "@/lib/types";

import { API_BASE_URL } from "@/lib/apiTarget";

interface UseHolidayRequestsResult {
  requests: HolidayRequestRecord[];
  loading: boolean;
  error: string | null;
  upsert: (date: string, kind: HolidayRequestKind) => Promise<void>;
  remove: (date: string) => Promise<void>;
}

interface ApiHolidayRequestsResponse {
  requests: Array<{
    person_id: string;
    date: string;
    kind: HolidayRequestKind;
    order: number;
    is_approved: boolean;
  }>;
}

export default function useHolidayRequests(year: number, month: number): UseHolidayRequestsResult {
  const [requests, setRequests] = useState<HolidayRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {identity: verified, status} = useIdentity();
  const ready=status==='verified';
  const userId=verified?.user_id;

  const endpoint = useMemo(() => `${API_BASE_URL}/holiday-requests/${year}/${month}`, [year, month]);

  const generation=useRef(0), pending=useRef<AbortController|null>(null);
  const scopeKey=JSON.stringify([endpoint,userId,ready]);
  const currentScope=useRef(scopeKey);
  useLayoutEffect(()=>{currentScope.current=scopeKey;},[scopeKey]);
  const fetchRequests = useCallback(async () => {
    if (!ready) {
      return;
    }
    if(currentScope.current!==scopeKey)return;
    const request=++generation.current;
    pending.current?.abort();
    const controller=new AbortController();pending.current=controller;
    const current=()=>request===generation.current&&currentScope.current===scopeKey&&!controller.signal.aborted;
    setLoading(true);
    setError(null);
    try {
      const legacy=await getLegacyClientContext(controller.signal);
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "include", signal:controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "希望休データの取得に失敗しました");
      }
      const payload = (await response.json()) as ApiHolidayRequestsResponse;
      const mapped = payload.requests.map((item) => ({
        personId: item.person_id,
        date: item.date,
        kind: item.kind,
        order: item.order,
        isApproved: item.is_approved,
      }));
      if(current())setRequests(mapped.filter(req=>req.personId===legacy.personId));
    } catch (err) {
      if(current()){setError(err instanceof Error ? err.message : "希望休データの取得に失敗しました");setRequests([]);}
    } finally {
      if(current())setLoading(false);
    }
  }, [endpoint, ready, scopeKey]);

  useEffect(() => {
    setRequests([]);
    void fetchRequests();
    const invalidate=()=>{generation.current++;pending.current?.abort();};
    return invalidate;
  }, [fetchRequests]);

  const handleUpsert = useCallback(
    async (targetDate: string, kind: HolidayRequestKind) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: targetDate, kind }),
        credentials: "include",
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "希望休の登録に失敗しました");
      }
      await fetchRequests();
    },
    [endpoint, fetchRequests],
  );

  const handleDelete = useCallback(
    async (targetDate: string) => {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: targetDate }),
        credentials: "include",
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "希望休の削除に失敗しました");
      }
      await fetchRequests();
    },
    [endpoint, fetchRequests],
  );

  return {
    requests,
    loading,
    error,
    upsert: handleUpsert,
    remove: handleDelete,
  };
}
