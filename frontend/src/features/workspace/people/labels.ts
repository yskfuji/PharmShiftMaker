export const ROLE: Record<string, string> = { ADMIN: "システム管理者", LEADER: "薬剤部責任者", PHARMACIST: "薬剤師" };

export const TASK: Record<string, string> = {
  contract: "雇用契約の確認", qualification: "資格の確認", membership: "本人アカウントの紐付け", candidate_generation: "勤務候補の生成",
  contract_end: "契約終了の確認", candidate_exclusion: "勤務候補からの除外", balance_review: "休暇残高の確認", membership_deactivation: "アカウントの無効化",
};
