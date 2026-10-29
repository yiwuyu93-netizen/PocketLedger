"use strict";

/* =========================================
   1. 基础配置
========================================= */

const STORAGE_KEY = "pocket-ledger-records-v1";

const CATEGORIES = [
  {
    name: "餐饮",
    icon: "🍜",
    color: "#fff0e5",
    foreground: "#e68a49"
  },
  {
    name: "交通",
    icon: "🚇",
    color: "#e7f2ff",
    foreground: "#4d91e8"
  },
  {
    name: "购物",
    icon: "🛍️",
    color: "#fce9f0",
    foreground: "#d96e99"
  },
  {
    name: "居住",
    icon: "🏠",
    color: "#e8f7ee",
    foreground: "#4aab79"
  },
  {
    name: "娱乐",
    icon: "🎮",
    color: "#f0eaff",
    foreground: "#9070df"
  },
  {
    name: "医疗",
    icon: "💊",
    color: "#ffe9e9",
    foreground: "#df7777"
  },
  {
    name: "学习",
    icon: "📚",
    color: "#fff4d9",
    foreground: "#c69a36"
  },
  {
    name: "其他",
    icon: "📦",
    color: "#edf0f6",
    foreground: "#77819a"
  }
];

const CATEGORY_MAP = new Map(
  CATEGORIES.map(category => [
    category.name,
    category
  ])
);

const PAGE_TITLES = {
  home: "我的账本",
  stats: "支出统计",
  records: "全部记录",
  settings: "设置"
};

/*
 * 每条记录的数据结构：
 *
 * {
 *   id: "唯一标识",
 *   amount: 1235,          // 单位：分
 *   category: "餐饮",
 *   note: "午餐",
 *   date: "2026-10-29",
 *   createdAt: 1793260000000
 * }
 */

let records = [];
let selectedCategory = "餐饮";
let currentPage = "home";
let toastTimer = null;
let lastFocusedElement = null;


/* =========================================
   2. DOM 工具
========================================= */

const $ = selector => document.querySelector(selector);

const $$ = selector => [
  ...document.querySelectorAll(selector)
];

const elements = {
  pageTitle: $("#page-title"),

  homeTotal: $("#home-total"),
  homeCount: $("#home-count"),
  homeCategories: $("#home-categories"),
  homeRecords: $("#home-records"),

  statsTotal: $("#stats-total"),
  statsCount: $("#stats-count"),
  statsAverage: $("#stats-average"),
  statsCategories: $("#stats-categories"),
  weeklyChart: $("#weekly-chart"),

  recordsSubtitle: $("#records-subtitle"),
  allRecords: $("#all-records"),
  filterCategory: $("#filter-category"),

  settingsCount: $("#settings-count"),
  offlineStatus: $("#offline-status"),

  modal: $("#expense-modal"),
  expenseForm: $("#expense-form"),
  expenseAmount: $("#expense-amount"),
  expenseCategory: $("#expense-category"),
  expenseNote: $("#expense-note"),
  expenseDate: $("#expense-date"),
  categoryPicker: $("#category-picker"),

  toast: $("#toast"),
  importFile: $("#import-file")
};


/* =========================================
   3. 日期与金额工具
========================================= */

/**
 * 返回本地时区的 YYYY-MM-DD。
 *
 * 不直接使用 new Date().toISOString().slice(0, 10)，
 * 因为 toISOString() 使用 UTC，可能造成日期偏移。
 */
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


/**
 * 验证日期格式并检查日期是否真实存在。
 */
function isValidDateString(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const [year, month, day] = value
    .split("-")
    .map(Number);

  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}


/**
 * 将整数分转换为人民币格式。
 */
function formatMoney(cents) {
  const amount = cents / 100;

  return "¥" + amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


/**
 * 将元转换为整数分。
 */
function yuanToCents(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return null;
  }

  if (amount <= 0 || amount > 999999999) {
    return null;
  }

  /*
   * 对输入金额最多保留两位小数。
   * 加入一个很小的容差以避免浮点数边界问题。
   */
  const cents = Math.round(amount * 100 + 1e-8);

  if (
    !Number.isSafeInteger(cents) ||
    cents < 1 ||
    cents > 99999999900
  ) {
    return null;
  }

  return cents;
}


/**
 * 安全转义用户输入，避免备注内容被当成 HTML。
 */
function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    character => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };

      return entities[character];
    }
  );
}


/**
 * 生成记录 ID。
 */
function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 12)
  );
}


/* =========================================
   4. 数据验证与持久化
========================================= */

/**
 * 验证单条记录。
 *
 * 导入数据和本地数据都经过相同的验证。
 */
function normalizeRecord(record) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record)
  ) {
    return null;
  }

  if (
    typeof record.id !== "string" ||
