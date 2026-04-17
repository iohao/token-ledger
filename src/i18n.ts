export type Locale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "tokenledger.locale";
const LEGACY_LOCALE_STORAGE_KEYS = ["tokenaccount.locale", "codex-usage-tauri.locale"];

const MESSAGES = {
  "zh-CN": {
    skipToMainContent: "跳到主要内容",
    dashboardViewsAria: "看板视图",
    language: "Language / 语言",
    languageSwitcherAria: "Choose language / 选择语言",
    languageChinese: "中文 / Chinese",
    languageEnglish: "English / 英文",
    notSyncedYet: "尚未同步",
    syncingShort: "同步中…",
    countdown: "倒计时 {value}",
    periodToday: "今日统计",
    periodLast7Days: "7日统计",
    periodMonthToDate: "本月统计",
    statusIdle: "空闲",
    statusSyncing: "同步中",
    statusSuccess: "已同步",
    statusFailed: "失败",
    summaryTotal: "总量",
    input: "输入",
    output: "输出",
    cachedInput: "缓存读取",
    reasoning: "推理",
    cost: "成本",
    dailySummaryEyebrow: "每日汇总",
    historySummaryEyebrow: "历史统计",
    date: "日期",
    month: "月份",
    model: "模型",
    total: "总量",
    totalLabel: "合计",
    modelCost: "模型成本",
    totalCost: "总成本",
    noData: "无数据",
    emptyStateEyebrow: "空状态",
    navOverview: "概览",
    navDailyDetail: "按日查询用量",
    navMonthlyHistory: "每月用量汇总",
    navSyncInfo: "同步说明",
    dashboardTitle: "TokenLedger",
    heroStatus: "状态 {status}",
    heroTimeZone: "时区 {timeZone}",
    heroTrackedSessions: "已追踪 {count} 个会话",
    heroSyncPreviewUnavailable: "待同步信息未加载",
    heroPendingSessions: "待同步 {count}",
    heroCaughtUp: "已追平源数据",
    syncButton: "同步数据",
    syncPendingMigration: "同步待迁移",
    syncFrequency: "同步频率",
    lastSynced: "最近同步",
    sessionDeltaSummary: "新增 {newCount} / 变更 {changedCount} / 删除 {removedCount} 个会话",
    lastSevenDaysDisplay: "最近7日显示",
    localData: "本地数据",
    syncInfoTitle: "同步说明",
    codexDirectory: "Codex 目录",
    sqlite: "SQLite",
    sqlitePath: "SQLite 路径",
    sqlitePathSection: "路径设置",
    sqlitePathHint: "修改后会切换到新的 SQLite 文件，并将该路径保存为应用配置。",
    savePath: "保存路径",
    savingPath: "保存中…",
    resetDefaultPath: "恢复默认路径",
    sqlitePathSaved: "SQLite 路径已更新。",
    sqlitePathReset: "SQLite 路径已恢复为默认值。",
    sqlitePathLockedByEnv: "当前 SQLite 路径由环境变量 CODEX_USAGE_DATABASE 控制，应用内不可修改。",
    databasePathSource: "当前来源: {source}",
    databasePathSourceEnv: "环境变量",
    databasePathSourceConfig: "自定义配置",
    databasePathSourceDefault: "默认路径",
    parseVersion: "解析版本",
    coverageThrough: "覆盖到",
    scannedFiles: "扫描文件",
    affectedSessions: "受影响会话数",
    dailyUsageTitle: "按日查询用量",
    readyToQueryDailyUsage: "准备查询按日用量",
    readyToQueryDailyUsageDescription: "选择起止日期后查询。",
    noDataInRangeTitle: "这个日期范围没有数据",
    noDataInRangeDescription: "可以换一个日期范围再查。",
    queryByDate: "按日期查询",
    startDate: "开始日期",
    endDate: "结束日期",
    queryDailyUsage: "查询按日用量",
    querying: "查询中…",
    dailyUsageLoading: "正在查询按日用量…",
    dailyUsageHint: "按日期范围查看每天的模型汇总。当前结果会保留空白日期，方便对比波动。单次最多查询 {maxDays} 天，并按页展示结果。",
    dailyUsageRangeTooLarge: "日期范围最多支持 {maxDays} 天，请缩小后再查询。",
    dailyUsagePaginationAria: "每日用量分页",
    dailyUsagePageSummary: "显示第 {start} 至 {end} 天，共 {total} 天",
    previousPage: "上一页",
    nextPage: "下一页",
    pageIndicator: "第 {current} / {total} 页",
    loadingDashboard: "正在加载仪表盘…",
    dashboardNotLoaded: "仪表盘尚未加载",
    currentStatus: "当前状态 {status}",
    loadingPage: "正在加载页面…",
    selectDateRangeError: "请选择开始日期和结束日期。",
    invalidDateRangeError: "开始日期不能晚于结束日期。",
    autoSyncManual: "手动",
    autoSync10s: "10秒",
    autoSync30s: "30秒",
    autoSync1m: "1分钟",
    autoSync5m: "5分钟",
    autoSync10m: "10分钟",
    autoSync15m: "15分钟",
    autoSync30m: "30分钟",
    activeSessionNote:
      "当前活跃的 Codex 会话文件会持续写入，所以同步后仍可能看到少量待同步会话。",
    dailyUsageOnDate: "{date} 统计",
    dailyUsageInRange: "{start} 至 {end}",
    fallbackSuffix: "（fallback）",
    syncProgressTitle: "同步进度",
    syncPhasePreparing: "准备同步环境",
    syncPhaseScanningFiles: "扫描会话文件",
    syncPhaseProcessingFiles: "解析并写入 SQLite",
    syncPhaseFinalizing: "重建汇总数据",
    syncPhaseComplete: "同步完成，正在刷新",
    syncPhaseFailed: "同步失败",
    syncProgressFilesDiscovered: "发现 {count} 个会话文件",
    syncProgressFilesProcessed: "已处理 {processed}/{total} 个待更新文件",
    syncProgressWaiting: "正在等待第一条进度…",
    syncProgressRemovedSessions: "待删除 {count} 个会话",
    syncProgressPercent: "{value}%",
  },
  "en-US": {
    skipToMainContent: "Skip to main content",
    dashboardViewsAria: "Dashboard views",
    language: "Language / 语言",
    languageSwitcherAria: "Choose language / 选择语言",
    languageChinese: "中文 / Chinese",
    languageEnglish: "English / 英文",
    notSyncedYet: "Not synced yet",
    syncingShort: "Syncing…",
    countdown: "Countdown {value}",
    periodToday: "Today",
    periodLast7Days: "Last 7 days",
    periodMonthToDate: "Month to date",
    statusIdle: "Idle",
    statusSyncing: "Syncing",
    statusSuccess: "Synced",
    statusFailed: "Failed",
    summaryTotal: "Total",
    input: "Input",
    output: "Output",
    cachedInput: "Cached input",
    reasoning: "Reasoning",
    cost: "Cost",
    dailySummaryEyebrow: "Daily summary",
    historySummaryEyebrow: "History",
    date: "Date",
    month: "Month",
    model: "Model",
    total: "Total",
    totalLabel: "Total",
    modelCost: "Model cost",
    totalCost: "Total cost",
    noData: "No data",
    emptyStateEyebrow: "Empty state",
    navOverview: "Overview",
    navDailyDetail: "Daily usage",
    navMonthlyHistory: "Monthly usage",
    navSyncInfo: "Sync details",
    dashboardTitle: "TokenLedger",
    heroStatus: "Status {status}",
    heroTimeZone: "Timezone {timeZone}",
    heroTrackedSessions: "Tracked {count} sessions",
    heroSyncPreviewUnavailable: "Pending sync info unavailable",
    heroPendingSessions: "{count} pending",
    heroCaughtUp: "Source data synced",
    syncButton: "Sync data",
    syncPendingMigration: "Sync pending migration",
    syncFrequency: "Sync frequency",
    lastSynced: "Last synced",
    sessionDeltaSummary: "{newCount} new / {changedCount} changed / {removedCount} removed sessions",
    lastSevenDaysDisplay: "Last 7 days",
    localData: "Local data",
    syncInfoTitle: "Sync details",
    codexDirectory: "Codex directory",
    sqlite: "SQLite",
    sqlitePath: "SQLite path",
    sqlitePathSection: "Path settings",
    sqlitePathHint: "After saving, the app switches to the new SQLite file and stores this path in app settings.",
    savePath: "Save path",
    savingPath: "Saving…",
    resetDefaultPath: "Reset to default",
    sqlitePathSaved: "SQLite path updated.",
    sqlitePathReset: "SQLite path reset to the default value.",
    sqlitePathLockedByEnv: "The current SQLite path is controlled by CODEX_USAGE_DATABASE and cannot be changed in the app.",
    databasePathSource: "Current source: {source}",
    databasePathSourceEnv: "environment variable",
    databasePathSourceConfig: "custom setting",
    databasePathSourceDefault: "default path",
    parseVersion: "Parse version",
    coverageThrough: "Coverage through",
    scannedFiles: "Scanned files",
    affectedSessions: "Affected sessions",
    dailyUsageTitle: "Daily usage",
    readyToQueryDailyUsage: "Ready to query daily usage",
    readyToQueryDailyUsageDescription: "Choose a start and end date to begin.",
    noDataInRangeTitle: "No data in this date range",
    noDataInRangeDescription: "Try a different date range.",
    queryByDate: "Query by date",
    startDate: "Start date",
    endDate: "End date",
    queryDailyUsage: "Query daily usage",
    querying: "Querying…",
    dailyUsageLoading: "Loading daily usage…",
    dailyUsageHint:
      "Browse model totals day by day for a selected date range. Empty days are kept to make changes easier to compare. Each query is capped at {maxDays} days and rendered page by page.",
    dailyUsageRangeTooLarge: "Date ranges can include at most {maxDays} days. Narrow the query and try again.",
    dailyUsagePaginationAria: "Daily usage pagination",
    dailyUsagePageSummary: "Showing days {start} to {end} of {total}",
    previousPage: "Previous",
    nextPage: "Next",
    pageIndicator: "Page {current} of {total}",
    loadingDashboard: "Loading dashboard…",
    dashboardNotLoaded: "Dashboard not loaded yet",
    currentStatus: "Current status {status}",
    loadingPage: "Loading page…",
    selectDateRangeError: "Please choose both a start date and an end date.",
    invalidDateRangeError: "Start date cannot be later than end date.",
    autoSyncManual: "Manual",
    autoSync10s: "10 sec",
    autoSync30s: "30 sec",
    autoSync1m: "1 min",
    autoSync5m: "5 min",
    autoSync10m: "10 min",
    autoSync15m: "15 min",
    autoSync30m: "30 min",
    activeSessionNote:
      "Active Codex session files may still be written after a sync, so a small number of pending sessions can remain.",
    dailyUsageOnDate: "Usage on {date}",
    dailyUsageInRange: "{start} to {end}",
    fallbackSuffix: " (fallback)",
    syncProgressTitle: "Sync progress",
    syncPhasePreparing: "Preparing sync",
    syncPhaseScanningFiles: "Scanning session files",
    syncPhaseProcessingFiles: "Parsing and writing SQLite data",
    syncPhaseFinalizing: "Rebuilding aggregates",
    syncPhaseComplete: "Sync complete, refreshing",
    syncPhaseFailed: "Sync failed",
    syncProgressFilesDiscovered: "{count} session files found",
    syncProgressFilesProcessed: "{processed}/{total} pending files processed",
    syncProgressWaiting: "Waiting for the first progress update…",
    syncProgressRemovedSessions: "{count} sessions pending removal",
    syncProgressPercent: "{value}%",
  },
} as const;

type MessageKey = keyof (typeof MESSAGES)["zh-CN"];

const ZH_PRICING_NOTE_MAP: Record<string, string> = {
  "GPT-5.4 / GPT-5.4-mini / GPT-5.3-Codex rates use OpenAI Codex Rate Card values, converted from credits with a 25 credits = 1 USD inference.":
    "GPT-5.4 / GPT-5.4-mini / GPT-5.3-Codex 的价格采用 OpenAI Codex Rate Card，并按 25 credits = 1 USD 推算为美元成本。",
  "GPT-5.3-Codex-Spark is still marked as not final by OpenAI; this dashboard estimates Spark cost using GPT-5.3-Codex rates.":
    "OpenAI 仍将 GPT-5.3-Codex-Spark 标记为未最终定价；本看板暂按 GPT-5.3-Codex 的费率估算 Spark 成本。",
};

function interpolate(template: string, variables: Record<string, string | number>): string {
  return Object.entries(variables).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export function isLocale(value: string): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

export function detectInitialLocale(): Locale {
  const demoLocale = readDemoLocaleOverride();
  if (demoLocale) {
    return demoLocale;
  }

  const stored = readStoredLocale();
  if (stored) {
    return stored;
  }

  return "en-US";
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    for (const legacyKey of LEGACY_LOCALE_STORAGE_KEYS) {
      window.localStorage.removeItem(legacyKey);
    }
  } catch {
    // Ignore unavailable storage in restricted environments.
  }
}

export function t(locale: Locale, key: MessageKey, variables: Record<string, string | number> = {}): string {
  return interpolate(MESSAGES[locale][key], variables);
}

export function translatePricingNote(locale: Locale, note: string): string {
  if (locale === "en-US") {
    return note;
  }

  return ZH_PRICING_NOTE_MAP[note] ?? note;
}

export function translateErrorMessage(locale: Locale, message: string): string {
  if (locale === "en-US") {
    return message;
  }

  const knownPatterns: Array<[RegExp, (matches: RegExpExecArray) => string]> = [
    [/^unsupported time zone: (.+)$/i, (matches) => `不支持的时区: ${matches[1]}`],
    [/^unsupported date key: (.+)$/i, (matches) => `不支持的日期键: ${matches[1]}`],
    [/^unsupported start_date: (.+)$/i, (matches) => `不支持的开始日期: ${matches[1]}`],
    [/^unsupported end_date: (.+)$/i, (matches) => `不支持的结束日期: ${matches[1]}`],
    [/^sync lock poisoned$/i, () => "同步锁异常，请稍后重试。"],
    [/^sync is already running$/i, () => "同步任务已在运行中。"],
    [/^database path cannot be empty$/i, () => "SQLite 路径不能为空。"],
    [
      /^database path is managed by CODEX_USAGE_DATABASE and cannot be changed in the app$/i,
      () => "当前 SQLite 路径由环境变量 CODEX_USAGE_DATABASE 控制，应用内不可修改。"
    ],
  ];

  for (const [pattern, formatter] of knownPatterns) {
    const matches = pattern.exec(message);
    if (matches) {
      return formatter(matches);
    }
  }

  return message;
}

function readStoredLocale(): Locale | null {
  try {
    const storageKeys = [LOCALE_STORAGE_KEY, ...LEGACY_LOCALE_STORAGE_KEYS];

    for (const storageKey of storageKeys) {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored || !isLocale(stored)) {
        continue;
      }

      if (storageKey !== LOCALE_STORAGE_KEY) {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, stored);
        window.localStorage.removeItem(storageKey);
      }

      return stored;
    }

    return null;
  } catch {
    return null;
  }
}

function readDemoLocaleOverride(): Locale | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") !== "1") {
      return null;
    }

    const locale = params.get("locale");
    return locale && isLocale(locale) ? locale : null;
  } catch {
    return null;
  }
}
