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
    record.id.length < 1 ||
    record.id.length > 100
  ) {
    return null;
  }

  if (
    !Number.isSafeInteger(record.amount) ||
    record.amount < 1 ||
    record.amount > 99999999900
  ) {
    return null;
  }

  if (!CATEGORY_MAP.has(record.category)) {
    return null;
  }

  if (!isValidDateString(record.date)) {
    return null;
  }

  if (
    typeof record.note !== "string" ||
    record.note.length > 100
  ) {
    return null;
  }

  if (
    !Number.isSafeInteger(record.createdAt) ||
    record.createdAt < 0
  ) {
    return null;
  }

  return {
    id: record.id,
    amount: record.amount,
    category: record.category,
    note: record.note,
    date: record.date,
    createdAt: record.createdAt
  };
}


/**
 * 从 localStorage 读取账本。
 */
function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw === null) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("账本数据格式不正确");
    }

    const result = [];
    const seenIds = new Set();

    for (const item of parsed) {
      const normalized = normalizeRecord(item);

      if (!normalized) {
        continue;
      }

      if (seenIds.has(normalized.id)) {
        continue;
      }

      seenIds.add(normalized.id);
      result.push(normalized);
    }

    return result;

  } catch (error) {
    console.error("读取账本失败：", error);

    showToast(
      "账本读取失败，请检查浏览器存储空间"
    );
    return [];
  }
}


/**
 * 将当前账本保存到 localStorage。
 *
 * 保存失败时返回 false，调用者可以保留旧数据。
 */
function persistRecords(nextRecords) {
  try {
    const json = JSON.stringify(nextRecords);

    localStorage.setItem(STORAGE_KEY, json);

    return true;

  } catch (error) {
    console.error("保存账本失败：", error);

    showToast(
      "保存失败，可能是浏览器存储空间不足"
    );

    return false;
  }
}


/**
 * 保存并提交新的账本状态。
 *
 * 只有成功写入 localStorage 后，
 * 才更新内存中的 records。
 */
function commitRecords(nextRecords) {
  if (!persistRecords(nextRecords)) {
    return false;
  }

  records = nextRecords;

  renderAll();

  return true;
}


/* =========================================
   5. 记录排序与统计
========================================= */

/**
 * 返回按日期倒序排列的副本。
 *
 * 同一天的记录按创建时间倒序排列。
 */
function getSortedRecords(source = records) {
  return [...source].sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }

    return b.createdAt - a.createdAt;
  });
}


/**
 * 计算累计支出。
 */
function getTotal(source = records) {
  return source.reduce(
    (sum, record) => sum + record.amount,
    0
  );
}


/**
 * 按分类汇总。
 */
function getCategoryStats() {
  const totals = new Map();

  for (const category of CATEGORIES) {
    totals.set(category.name, {
      amount: 0,
      count: 0
    });
  }

  for (const record of records) {
    const item = totals.get(record.category);

    item.amount += record.amount;
    item.count += 1;
  }

  return CATEGORIES
    .map(category => ({
      ...category,
      amount: totals.get(category.name).amount,
      count: totals.get(category.name).count
    }))
    .sort((a, b) => b.amount - a.amount);
}


/**
 * 将日期转为易读格式。
 */
function formatRecordDate(dateString) {
  if (dateString === getLocalDateString()) {
    return "今天";
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (dateString === getLocalDateString(yesterday)) {
    return "昨天";
  }

  const [, month, day] = dateString.split("-");

  return `${Number(month)}月${Number(day)}日`;
}


/* =========================================
   6. 通用空状态与分类图标
========================================= */

function emptyState(title, description) {
  return `
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true">🧾</div>

      <strong>${escapeHTML(title)}</strong>

      <p>${escapeHTML(description)}</p>
    </div>
  `;
}


/**
 * 获取分类图标 HTML。
 */
function categoryIcon(category, extraClass = "") {
  return `
    <span
      class="category-icon ${extraClass}"
      style="
        background:${category.color};
        color:${category.foreground};
      "
      aria-hidden="true"
    >
      ${category.icon}
    </span>
  `;
}


/* =========================================
   7. 渲染首页
========================================= */

function renderHome() {
  const total = getTotal();

  elements.homeTotal.textContent = formatMoney(total);

  elements.homeCount.textContent = `${records.length} 笔`;

  renderHomeCategories();

  renderHomeRecords();
}


/**
 * 首页分类卡片：
 * 展示每个分类的累计支出。
 */
function renderHomeCategories() {
  const stats = getCategoryStats();

  elements.homeCategories.innerHTML = stats
    .map(category => `
      <div class="category-card">
        ${categoryIcon(category)}

        <span class="category-name">
          ${escapeHTML(category.name)}
        </span>

        <span class="category-amount">
          ${formatMoney(category.amount)}
        </span>
      </div>
    `)
    .join("");
}


/**
 * 首页显示最近 5 笔记录。
 */
function renderHomeRecords() {
  const latest = getSortedRecords().slice(0, 5);

  if (latest.length === 0) {
    elements.homeRecords.innerHTML = emptyState(
      "还没有支出记录",
      "点击上方的按钮，记下你的第一笔支出吧"
    );

    return;
  }

  elements.homeRecords.innerHTML = latest
    .map(renderRecordCard)
    .join("");
}


/* =========================================
   8. 渲染记录卡片
========================================= */

function renderRecordCard(record) {
  const category = CATEGORY_MAP.get(record.category);

  const title = record.note.trim()
    ? record.note.trim()
    : record.category;

  return `
    <article class="record-card">

      <span
        class="record-icon"
        style="
          background:${category.color};
          color:${category.foreground};
        "
        aria-hidden="true"
      >
        ${category.icon}
      </span>

      <div class="record-info">

        <h3 class="record-title">
          ${escapeHTML(title)}
        </h3>

        <div class="record-meta">

          <span>${escapeHTML(record.category)}</span>

          <span aria-hidden="true">·</span>

          <time datetime="${record.date}">
            ${formatRecordDate(record.date)}
          </time>

        </div>

      </div>

      <div class="record-right">

        <span class="record-amount">
          −${formatMoney(record.amount)}
        </span>

        <button
          class="delete-button"
          type="button"
          data-delete-id="${escapeHTML(record.id)}"
          aria-label="删除 ${escapeHTML(title)} 这笔记录"
        >
          删除
        </button>

      </div>

    </article>
  `;
}


/* =========================================
   9. 渲染统计页面
========================================= */
function renderStats() {
  const total = getTotal();

  elements.statsTotal.textContent = formatMoney(total);

  elements.statsCount.textContent = `${records.length} 笔`;

  const average = records.length
    ? Math.round(total / records.length)
    : 0;

  elements.statsAverage.textContent = formatMoney(average);

  renderStatsCategories();

  renderWeeklyChart();
}


/**
 * 分类金额、笔数、占比和进度条。
 */
function renderStatsCategories() {
  const total = getTotal();
  const stats = getCategoryStats().filter(
    category => category.amount > 0
  );

  if (stats.length === 0) {
    elements.statsCategories.innerHTML = emptyState(
      "暂无统计数据",
      "添加支出后，这里就会显示分类统计"
    );

    return;
  }

  elements.statsCategories.innerHTML = stats
    .map(category => {
      const percent = total > 0
        ? category.amount / total * 100
        : 0;

      return `
        <article class="stats-category-card">

          <div class="stats-category-top">

            <span
              class="stats-category-icon"
              style="
                background:${category.color};
                color:${category.foreground};
              "
              aria-hidden="true"
            >
              ${category.icon}
            </span>

            <div class="stats-category-info">

              <div class="stats-category-name">
                ${escapeHTML(category.name)}
              </div>

              <div class="stats-category-subtitle">
                ${category.count} 笔支出
              </div>

            </div>

            <div class="stats-category-right">

              <div class="stats-category-amount">
                ${formatMoney(category.amount)}
              </div>

              <div class="stats-category-percent">
                ${percent.toFixed(1)}%
              </div>

            </div>

          </div>

          <div
            class="progress-track"
            role="progressbar"
            aria-label="${escapeHTML(category.name)}支出占比"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${percent.toFixed(1)}"
          >
            <div
              class="progress-fill"
              style="
                width:${Math.min(percent, 100)}%;
                background:${category.foreground};
              "
            ></div>
          </div>

        </article>
      `;
    })
    .join("");
}


/**
 * 最近 7 天每日支出柱状图。
 *
 * 包含今天和之前的 6 天。
 * 以本地日期计算，不使用 UTC 日期。
 */
function renderWeeklyChart() {
  const dailyTotals = new Map();
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const days = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);

    date.setDate(today.getDate() - i);

    const key = getLocalDateString(date);

    dailyTotals.set(key, 0);

    days.push({
      key,
      date,
      isToday: i === 0
    });
  }

  for (const record of records) {
    if (dailyTotals.has(record.date)) {
      dailyTotals.set(
        record.date,
        dailyTotals.get(record.date) + record.amount
      );
    }
  }

  const maxAmount = Math.max(
    ...dailyTotals.values(),
    0
  );

  elements.weeklyChart.innerHTML = days
    .map(day => {
      const amount = dailyTotals.get(day.key);

      const height = maxAmount > 0
        ? amount / maxAmount * 100
        : 0;

      const label = `${day.date.getMonth() + 1}/${day.date.getDate()}`;

      const accessibleAmount = formatMoney(amount);

      return `
        <div
          class="weekly-day"
          aria-label="${label}，支出${accessibleAmount}"
        >

          <span class="weekly-value">
            ${amount > 0
              ? escapeHTML(formatCompactMoney(amount))
              : "—"}
          </span>

          <div class="weekly-bar-area">

            <div
              class="weekly-bar ${day.isToday ? "today" : ""}"
              style="height:${Math.max(height, amount > 0 ? 4 : 0)}%"
              title="${label}：${accessibleAmount}"
            ></div>

          </div>

          <span class="weekly-label">
            ${day.isToday ? "今天" : label}
          </span>

        </div>
      `;
    })
    .join("");
}


/**
 * 图表中使用紧凑金额，避免标签过长。
 */
function formatCompactMoney(cents) {
  const yuan = cents / 100;

  if (yuan >= 10000) {
    return `${(yuan / 10000).toFixed(1)}万`;
  }

  if (yuan >= 1000) {
    return `${(yuan / 1000).toFixed(1)}k`;
  }

  if (yuan >= 100) {
    return yuan.toFixed(0);
  }

  return yuan.toFixed(0);
}


/* =========================================
   10. 渲染全部记录
========================================= */

function renderRecords() {
  const category = elements.filterCategory.value || "all";

  const filtered = getSortedRecords().filter(record => {
    return category === "all" ||
      record.category === category;
  });

  elements.recordsSubtitle.textContent =
    `共 ${filtered.length} 笔记录`;

  if (filtered.length === 0) {
    const title = records.length === 0
      ? "还没有记录"
      : "没有符合条件的记录";

    const description = records.length === 0
      ? "点击右上角的按钮，添加一笔支出"
      : "试试切换分类，看看其他记录";

    elements.allRecords.innerHTML = emptyState(
      title,
      description
    );

    return;
  }

  elements.allRecords.innerHTML = filtered
    .map(renderRecordCard)
    .join("");
}


/* =========================================
   11. 渲染设置页面
========================================= */

function renderSettings() {
  elements.settingsCount.textContent = `${records.length} 笔`;

  updateOfflineStatus();
}


function updateOfflineStatus() {
  if (!("serviceWorker" in navigator)) {
    elements.offlineStatus.textContent = "不支持";
    return;
  }

  if (!window.isSecureContext) {
    elements.offlineStatus.textContent = "需要 HTTPS";
    return;
  }

  if (navigator.serviceWorker.controller) {
    elements.offlineStatus.textContent = "已启用";
    return;
  }

  elements.offlineStatus.textContent = "等待缓存";
}


/* =========================================
   12. 统一渲染
========================================= */

function renderAll() {
  renderHome();
  renderStats();
  renderRecords();
  renderSettings();
}


/* =========================================
   13. 分类选择器
========================================= */

function renderCategoryPicker() {
  elements.categoryPicker.innerHTML = CATEGORIES
    .map(category => `
      <button
        class="category-option ${
          category.name === selectedCategory
            ? "selected"
            : ""
        }"
        type="button"
        data-category="${escapeHTML(category.name)}"
        aria-pressed="${
          category.name === selectedCategory
        }"
      >

        ${categoryIcon(category)}

        <span>${escapeHTML(category.name)}</span>

      </button>
    `)
    .join("");
}


function renderFilterOptions() {
  elements.filterCategory.innerHTML = `
    <option value="all">全部分类</option>

    ${CATEGORIES.map(category => `
      <option value="${escapeHTML(category.name)}">
        ${escapeHTML(category.name)}
      </option>
    `).join("")}
  `;
}


/* =========================================
   14. 页面导航
========================================= */
function navigateTo(pageName) {
  if (!PAGE_TITLES[pageName]) {
    return;
  }

  currentPage = pageName;

  $$(".page").forEach(page => {
    page.classList.toggle(
      "active",
      page.id === `page-${pageName}`
    );
  });

  $$(".nav-item").forEach(button => {
    const active = button.dataset.page === pageName;

    button.classList.toggle("active", active);

    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  elements.pageTitle.textContent = PAGE_TITLES[pageName];

  window.scrollTo({
    top: 0,
    behavior: "auto"
  });

  /*
   * 切换页面时刷新当前页面的相关数据。
   */
  if (pageName === "home") {
    renderHome();
  }

  if (pageName === "stats") {
    renderStats();
  }

  if (pageName === "records") {
    renderRecords();
  }

  if (pageName === "settings") {
    renderSettings();
  }
}


/* =========================================
   15. 添加支出弹窗
========================================= */

function openExpenseModal() {
  lastFocusedElement = document.activeElement;

  elements.expenseForm.reset();

  selectedCategory = "餐饮";

  elements.expenseCategory.value = selectedCategory;

  elements.expenseDate.value = getLocalDateString();

  renderCategoryPicker();

  elements.modal.classList.add("open");

  elements.modal.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";

  window.setTimeout(() => {
    elements.expenseAmount.focus();
  }, 100);
}


function closeExpenseModal() {
  elements.modal.classList.remove("open");

  elements.modal.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";

  if (
    lastFocusedElement &&
    typeof lastFocusedElement.focus === "function"
  ) {
    lastFocusedElement.focus();
  }
}


/**
 * 保存一笔新支出。
 */
function handleExpenseSubmit(event) {
  event.preventDefault();

  const amount = yuanToCents(
    elements.expenseAmount.value
  );

  if (amount === null) {
    showToast("请输入有效金额，最多保留两位小数");
    elements.expenseAmount.focus();
    return;
  }

  const category = elements.expenseCategory.value;

  if (!CATEGORY_MAP.has(category)) {
    showToast("请选择有效分类");
    return;
  }

  const note = elements.expenseNote.value.trim();

  if (note.length > 100) {
    showToast("备注不能超过 100 个字符");
    return;
  }

  const date = elements.expenseDate.value;

  if (!isValidDateString(date)) {
    showToast("请选择有效日期");
    return;
  }

  const record = {
    id: createId(),
    amount,
    category,
    note,
    date,
    createdAt: Date.now()
  };

  const nextRecords = [
    ...records,
    record
  ];

  if (!commitRecords(nextRecords)) {
    return;
  }

  closeExpenseModal();

  showToast("支出记录已保存");

  /*
   * 添加后进入记录页，
   * 让用户直接看到新记录。
   */
  navigateTo("records");
}


/* =========================================
   16. 删除记录
========================================= */
function handleDeleteRecord(id) {
  const record = records.find(item => item.id === id);

  if (!record) {
    showToast("没有找到这笔记录");
    return;
  }

  const title = record.note.trim()
    ? record.note.trim()
    : record.category;

  const confirmed = window.confirm(
    `确定删除这笔记录吗？\n\n` +
    `${title}：${formatMoney(record.amount)}\n\n` +
    `删除后将无法直接恢复。`
  );

  if (!confirmed) {
    return;
  }

  const nextRecords = records.filter(
    item => item.id !== id
  );

  if (!commitRecords(nextRecords)) {
    return;
  }

  showToast("记录已删除");
}


/* =========================================
   17. 提示信息
========================================= */

function showToast(message) {
  window.clearTimeout(toastTimer);

  elements.toast.textContent = message;

  elements.toast.classList.add("show");

  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2400);
}


/* =========================================
   18. 导出账本
========================================= */

function exportRecords() {
  const exportData = {
    app: "PocketLedger",
    version: 1,
    exportedAt: new Date().toISOString(),
    records: getSortedRecords()
  };

  const blob = new Blob(
    [JSON.stringify(exportData, null, 2)],
    {
      type: "application/json;charset=utf-8"
    }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;

  link.download =
    `pocket-ledger-${getLocalDateString()}.json`;

  document.body.appendChild(link);

  link.click();

  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  showToast("账本数据已导出");
}


/* =========================================
   19. 导入账本
========================================= */

async function importRecords(file) {
  if (!file) {
    return;
  }

  /*
   * 防止误选过大的文件。
   */
  const maxFileSize = 10 * 1024 * 1024;

  if (file.size > maxFileSize) {
    showToast("导入文件不能超过 10 MB");
    return;
  }

  try {
    const text = await file.text();

    const parsed = JSON.parse(text);

    let imported;

    /*
     * 兼容本应用导出的标准格式。
     * 同时支持直接导入记录数组。
     */
    if (Array.isArray(parsed)) {
      imported = parsed;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.records)
    ) {
      imported = parsed.records;
    } else {
      throw new Error("文件格式不正确");
    }

    /*
     * 限制记录数量，避免异常文件占用过多资源。
     */
    if (imported.length > 50000) {
      throw new Error("记录数量超过 50000 笔");
    }

    const normalized = [];
    const seenIds = new Set();

    for (const item of imported) {
      const record = normalizeRecord(item);

      if (!record) {
        throw new Error(
          "文件中存在无效记录，请使用本应用导出的 JSON 文件"
        );
      }

      if (seenIds.has(record.id)) {
        throw new Error("文件中存在重复记录 ID");
      }

      seenIds.add(record.id);

      normalized.push(record);
    }

    const confirmed = window.confirm(
      `即将导入 ${normalized.length} 笔记录。\n\n` +
      `导入将替换当前账本的全部记录，` +
      `建议先导出当前数据作为备份。\n\n` +
      `确定继续吗？`
    );

    if (!confirmed) {
      return;
    }

    if (!commitRecords(normalized)) {
      return;
    }

    showToast(`成功导入 ${normalized.length} 笔记录`);

    navigateTo("home");

  } catch (error) {
    console.error("导入失败：", error);

    showToast(
      error.message || "导入失败，请检查文件格式"
    );

  } finally {
    elements.importFile.value = "";
  }
}


/* =========================================
   20. 清空全部记录
========================================= */
function clearAllRecords() {
  if (records.length === 0) {
    showToast("当前账本已经是空的");
    return;
  }

  const confirmed = window.confirm(
    `确定清空全部 ${records.length} 笔记录吗？\n\n` +
    `此操作无法直接恢复，建议先导出备份。`
  );

  if (!confirmed) {
    return;
  }

  if (!commitRecords([])) {
    return;
  }

  showToast("账本已清空");
}


/* =========================================
   21. Service Worker 注册
========================================= */

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    elements.offlineStatus.textContent = "不支持";
    return;
  }

  if (!window.isSecureContext) {
    elements.offlineStatus.textContent = "需要 HTTPS";
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      "./sw.js",
      {
        scope: "./"
      }
    );

    console.log(
      "Service Worker 注册成功：",
      registration.scope
    );

    updateOfflineStatus();

    /*
     * 首次安装、激活或控制状态变化后更新状态。
     */
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      updateOfflineStatus
    );

    registration.addEventListener(
      "updatefound",
      () => {
        const worker = registration.installing;

        if (!worker) {
          return;
        }

        worker.addEventListener(
          "statechange",
          updateOfflineStatus
        );
      }
    );

  } catch (error) {
    console.error("Service Worker 注册失败：", error);

    elements.offlineStatus.textContent = "注册失败";
  }
}


/* =========================================
   22. 事件绑定
========================================= */

function bindEvents() {

  /*
   * 底部导航与页面跳转按钮。
   */
  $$("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.page);
    });
  });


  /*
   * 打开添加支出弹窗。
   */
  $("#open-add-home").addEventListener(
    "click",
    openExpenseModal
  );

  $("#open-add-records").addEventListener(
    "click",
    openExpenseModal
  );


  /*
   * 关闭弹窗。
   */
  $("#close-modal").addEventListener(
    "click",
    closeExpenseModal
  );

  elements.modal.addEventListener("click", event => {
    if (event.target === elements.modal) {
      closeExpenseModal();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (elements.modal.classList.contains("open")) {
        closeExpenseModal();
      }
    }
  });


  /*
   * 分类选择。
   */
  elements.categoryPicker.addEventListener(
    "click",
    event => {
      const button = event.target.closest(
        "[data-category]"
      );

      if (!button) {
        return;
      }

      const category = button.dataset.category;

      if (!CATEGORY_MAP.has(category)) {
        return;
      }

      selectedCategory = category;

      elements.expenseCategory.value = category;

      renderCategoryPicker();
    }
  );


  /*
   * 提交新支出。
   */
  elements.expenseForm.addEventListener(
    "submit",
    handleExpenseSubmit
  );


  /*
   * 分类筛选。
   */
  elements.filterCategory.addEventListener(
    "change",
    renderRecords
  );


  /*
   * 删除记录。
   *
   * 使用事件委托，兼容动态生成的记录卡片。
   */
  document.addEventListener("click", event => {
    const button = event.target.closest(
      "[data-delete-id]"
    );

    if (!button) {
      return;
    }

    handleDeleteRecord(button.dataset.deleteId);
  });


  /*
   * 导出数据。
   */
  $("#export-data").addEventListener(
    "click",
    exportRecords
  );


  /*
   * 导入数据。
   */
  $("#import-data").addEventListener("click", () => {
    elements.importFile.click();
  });

  elements.importFile.addEventListener(
    "change",
    event => {
      const file = event.target.files?.[0];

      if (file) {
        importRecords(file);
      }
    }
  );


  /*
   * 清空账本。
   */
  $("#clear-data").addEventListener(
    "click",
    clearAllRecords
  );


  /*
   * 网络状态变化。
   */
  window.addEventListener("online", updateOfflineStatus);
  window.addEventListener("offline", updateOfflineStatus);
}


/* =========================================
   23. 应用初始化
========================================= */

function initApp() {

  /*
   * 初始化表单默认值。
   */
  elements.expenseDate.value = getLocalDateString();

  /*
   * 初始化分类选择器与筛选器。
   */
  renderCategoryPicker();
  renderFilterOptions();

  /*
   * 加载本地账本。
   */
  records = loadRecords();

  /*
   * 首次渲染。
   */
  renderAll();

  /*
   * 绑定交互事件。
   */
  bindEvents();

  /*
   * 注册离线缓存。
   */
  registerServiceWorker();

  console.log("小账本初始化完成");
}


/*
 * app.js 使用 defer 加载，
 * DOM 已经解析完成，可以直接初始化。
 */
initApp();