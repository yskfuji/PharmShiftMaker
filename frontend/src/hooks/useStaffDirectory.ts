"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/apiTarget";

export interface StaffDirectoryEntry {
  personId: string;
  name: string;
  role: string;
  status: string | null;
}

interface StaffApiResponse {
  total: number;
  items: Array<{
    person_id: string;
    name: string;
    role: string;
    current_status: string | null;
  }>;
}

interface UseStaffDirectoryResult {
  entries: StaffDirectoryEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export default function useStaffDirectory(includeInactive = false): UseStaffDirectoryResult {
  const [entries, setEntries] = useState<StaffDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/staff?include_inactive=${includeInactive ? "true" : "false"}`,
        { cache: "no-store", credentials: "include" },
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "スタッフ一覧の取得に失敗しました");
      }
      const payload = (await response.json()) as StaffApiResponse;
      const mapped = payload.items.map((item) => ({
        personId: item.person_id,
        name: item.name,
        role: item.role,
        status: item.current_status,
      }));
      setEntries(mapped);
    } catch (err) {
      setEntries([]);
      setError(err instanceof Error ? err.message : "スタッフ一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return { entries, loading, error, refresh: fetchEntries };
}
