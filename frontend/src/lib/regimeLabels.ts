/** Contract regimes and employment working-time systems in the words of the
    Labour Standards Act; unknown values are shown as they are. */
const REGIMES: Record<string, string> = {
  general: '一般制',
  variable: '変形労働時間制',
  flex: 'フレックスタイム制',
  exempt: '適用除外',
};

const SYSTEMS: Record<string, string> = {
  standard: '通常の労働時間制',
  monthly_variable: '1か月以内の変形労働時間制',
  annual_variable: '1年単位の変形労働時間制',
  flex: 'フレックスタイム制',
};

export const regimeLabel = (regime: string) => REGIMES[regime] ?? regime;
export const workingTimeSystemLabel = (system: string | null | undefined) => SYSTEMS[system ?? 'standard'] ?? String(system);
