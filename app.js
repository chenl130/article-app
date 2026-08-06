const state = {
  strategyReady: false,
  draftReady: false,
  reviewReady: false,
  approved: false,
  currentProjectId: null,
  currentStrategy: null,
  currentReview: null,
  currentSocial: null,
  selectedTitle: "",
  projects: [],
  knowledgeItems: [],
  authRequired: false,
  authenticated: false,
  currentUser: localStorage.getItem("ia_user_name") || "本机用户",
  log: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const roleNotes = {
  assistant: "可创建草稿、调整风格、提交律师审阅。",
  attorney: "可审阅法律风险、修改关键判断、批准发布。",
  admin: "可管理模板、知识库、用户权限和审计记录。",
};

const actionLabels = {
  tighten: "压缩冗余表达",
  legal: "增强法律严谨性",
  wechat: "增强公众号吸引力",
  risk: "加入实务风险感",
  antiAi: "去 AI 味处理",
  sanguo: "生成三国风小标题",
  poem: "添加诗词结尾",
  custom: "自定义微调",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getFormData() {
  const depth = document.querySelector("input[name='depth']:checked").value;
  return {
    topic: $("#topic").value.trim() || "未命名文章",
    category: $("#category").value,
    audience: $("#audience").value,
    channel: $("#channel").value,
    styleProfile: $("#styleProfile").value,
    articleType: $("#articleType").value,
    depth,
    legalRigor: $("#legalRigor").value,
    newsTone: $("#newsTone").value,
    antiAi: $("#antiAi").checked,
    riskFirst: $("#riskFirst").checked,
    wechatHook: $("#wechatHook").checked,
    historicalTone: $("#historicalTone").checked,
    sanguoTone: $("#sanguoTone").checked,
    poemClose: $("#poemClose").checked,
    materials: $("#materials").value.trim(),
  };
}

function inferTitleFromText(text) {
  const firstLine = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 80) : "";
}

function getFinalImportData() {
  const article = $("#finalArticle").value.trim();
  const title = $("#finalTitle").value.trim() || inferTitleFromText(article) || "律师定稿文章";
  return {
    article,
    title,
    form: {
      topic: title,
      category: $("#finalCategory").value,
      audience: $("#finalAudience").value,
      channel: "微信公众号",
      styleProfile: $("#finalStyleProfile").value,
      articleType: "定稿多平台改写",
      depth: "standard",
      legalRigor: "5",
      newsTone: "4",
      antiAi: true,
      riskFirst: true,
      wechatHook: true,
      historicalTone: false,
      sanguoTone: false,
      poemClose: false,
      materials: "来源：律师定稿导入。请保留原文法律判断，不重写公众号正文，只进行多平台改写和风格规则提炼。",
    },
  };
}

async function apiPost(path, payload) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error("无法连接本地后端。请刷新页面；如果仍失败，请重启 server.py。");
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin(data.error || "请先登录内测版本。");
    throw new Error(data.error || "请先登录内测版本。");
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `API request failed: ${response.status}`);
  }
  return data.result;
}

async function apiGet(path) {
  let response;
  try {
    response = await fetch(path);
  } catch (error) {
    throw new Error("无法连接本地后端。请确认 server.py 正在运行。");
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin(data.error || "请先登录内测版本。");
    throw new Error(data.error || "请先登录内测版本。");
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `API request failed: ${response.status}`);
  }
  return data.result;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function setBusy(button, busyText) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

function addLog(message) {
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  state.log.unshift(`${stamp} ${message}`);
  renderLog();
}

function renderLog() {
  $("#auditLog").innerHTML = state.log.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function showLogin(message = "") {
  $("#loginOverlay").classList.remove("hidden");
  $("#loginError").textContent = message;
  $("#loginUserName").value = localStorage.getItem("ia_user_name") || "";
}

function hideLogin() {
  $("#loginOverlay").classList.add("hidden");
  $("#loginError").textContent = "";
}

function updateUserNote() {
  $("#userNote").textContent = `当前使用者：${state.currentUser || "本机用户"}`;
  $("#logoutBtn").style.display = state.authRequired ? "inline-flex" : "none";
}

function toAbsoluteUrl(url) {
  if (!url) return "";
  try {
    return new URL(url, window.location.origin).toString();
  } catch (error) {
    return url;
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrapText(text, maxChars, maxLines = 99) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const lines = [];
  let current = "";
  for (const char of normalized) {
    const width = /[A-Za-z0-9]/.test(char) ? 0.55 : 1;
    const currentWidth = Array.from(current).reduce((sum, item) => sum + (/[A-Za-z0-9]/.test(item) ? 0.55 : 1), 0);
    if (current && currentWidth + width > maxChars) {
      lines.push(current);
      current = char.trimStart();
      if (lines.length >= maxLines) break;
    } else {
      current += char;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function createSvgDownloadUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildClearTextXhsSvg(card, index) {
  const palette = [
    { bg: "#f6f1e8", ink: "#1f2933", accent: "#7a5634", soft: "#efe2cc", tag: "#ffffff" },
    { bg: "#eef4f1", ink: "#18212b", accent: "#1f6f5b", soft: "#d8e8e2", tag: "#ffffff" },
    { bg: "#f3f5f8", ink: "#172033", accent: "#2d5d88", soft: "#dce7f1", tag: "#ffffff" },
    { bg: "#fbf4f0", ink: "#241d1b", accent: "#9f4b38", soft: "#f0d6cc", tag: "#ffffff" },
  ][index % 4];
  const titleLines = wrapText(card.title || "核心判断", 9, 3);
  const bodyLines = wrapText(card.body || "", 17, 8);
  const footerLines = wrapText(card.footer || "一般信息分享，不构成个案法律意见。", 22, 2);
  const visualTag = String(card.visual_direction || "NIW 系列").slice(0, 18);
  const chips = ["NIW", "证据工程", "律师审阅"].slice(0, 3);
  const bodyStart = 390 + Math.max(0, titleLines.length - 2) * 42;

  const textLines = (lines, x, y, size, lineHeight, weight = 500, fill = palette.ink) =>
    lines
      .map((line, lineIndex) => `<text x="${x}" y="${y + lineIndex * lineHeight}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`)
      .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1365" viewBox="0 0 1024 1365">
  <rect width="1024" height="1365" fill="${palette.bg}"/>
  <rect x="58" y="58" width="908" height="1249" rx="36" fill="rgba(255,255,255,0.48)" stroke="${palette.soft}" stroke-width="2"/>
  <rect x="92" y="92" width="840" height="8" rx="4" fill="${palette.accent}"/>
  <text x="92" y="180" font-size="78" font-weight="800" fill="${palette.accent}">${String(index + 1).padStart(2, "0")}</text>
  <line x1="244" y1="120" x2="244" y2="258" stroke="${palette.accent}" stroke-width="3"/>
  ${textLines(titleLines, 292, 168, 58, 76, 850)}
  <rect x="92" y="${bodyStart - 72}" width="840" height="${Math.max(360, bodyLines.length * 58 + 72)}" rx="28" fill="${palette.tag}" opacity="0.76"/>
  ${textLines(bodyLines, 128, bodyStart, 38, 58, 600)}
  <g transform="translate(92, ${bodyStart + Math.max(360, bodyLines.length * 58 + 72) + 54})">
    <rect x="0" y="0" width="840" height="132" rx="26" fill="${palette.soft}"/>
    <text x="34" y="52" font-size="24" font-weight="800" fill="${palette.accent}">视觉主题</text>
    <text x="34" y="96" font-size="32" font-weight="750" fill="${palette.ink}">${escapeXml(visualTag)}</text>
    ${chips.map((chip, chipIndex) => `
      <rect x="${500 + chipIndex * 104}" y="36" width="84" height="54" rx="18" fill="${palette.tag}" opacity="0.9"/>
      <text x="${542 + chipIndex * 104}" y="71" text-anchor="middle" font-size="20" font-weight="800" fill="${palette.accent}">${escapeXml(chip)}</text>
    `).join("")}
  </g>
  <g transform="translate(92, 1174)">
    <line x1="0" y1="0" x2="840" y2="0" stroke="${palette.soft}" stroke-width="3"/>
    ${textLines(footerLines, 0, 62, 28, 42, 550, "#687382")}
  </g>
  <text x="92" y="1268" font-size="22" font-weight="700" fill="#8b949e">Attorney-reviewed content draft · For general information only</text>
</svg>`;
}

function generateClearTextCard(index, button) {
  if (!state.currentSocial || !Array.isArray(state.currentSocial.xhs_cards)) {
    showToast("请先生成小红书卡片脚本");
    return;
  }
  const card = state.currentSocial.xhs_cards[index];
  if (!card) {
    showToast("找不到这张卡片");
    return;
  }
  const restore = setBusy(button, "生成中...");
  try {
    const svg = buildClearTextXhsSvg(card, index);
    const svgUrl = createSvgDownloadUrl(svg);
    card.clear_svg = svg;
    card.clear_svg_url = svgUrl;
    renderSocial(state.currentSocial);
    const preview = $(`[data-xhs-image-preview="${index}"]`);
    preview?.scrollIntoView({ behavior: "smooth", block: "center" });
    addLog(`生成清晰文字卡片：CARD ${index + 1}`);
    showToast(`CARD ${index + 1} 清晰文字卡片已生成`);
  } finally {
    restore();
  }
}

async function downloadClearTextPng(index) {
  const card = state.currentSocial?.xhs_cards?.[index];
  const svg = card?.clear_svg || buildClearTextXhsSvg(card || {}, index);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1365;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) {
        showToast("PNG 导出失败，可先下载 SVG");
        return;
      }
      const pngUrl = URL.createObjectURL(pngBlob);
      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = `xhs-card-${String(index + 1).padStart(2, "0")}.png`;
      link.click();
      URL.revokeObjectURL(pngUrl);
    }, "image/png");
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("PNG 导出失败，可先下载 SVG");
  };
  image.src = url;
}

function switchSection(id) {
  $$(".section").forEach((section) => section.classList.toggle("active", section.id === id));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === id));
}

function updateWorkflow() {
  const items = [
    ["任务参数已设定", true],
    ["文章策略已生成", state.strategyReady],
    ["初稿已生成", state.draftReady],
    ["风格与论证已优化", state.reviewReady],
    ["律师终审已完成", state.approved],
  ];
  $("#workflowList").innerHTML = items
    .map(([label, done]) => `<li class="${done ? "done" : ""}">${escapeHtml(label)}</li>`)
    .join("");
}

function updateMetrics() {
  const data = getFormData();
  const wordTargets = { quick: "1200", standard: "2600", deep: "4800" };
  $("#wordTarget").textContent = wordTargets[data.depth];
  $("#riskLevel").textContent = data.category === "EB-5" || data.riskFirst ? "中高" : "中";
}

function getSelectedKnowledge() {
  const selectedIds = $$(".knowledge-check:checked").map((input) => input.value);
  return state.knowledgeItems
    .filter((item) => selectedIds.includes(item.id))
    .map((item) => ({
      title: item.title,
      sourceType: item.sourceType,
      content: item.content.slice(0, 12000),
    }));
}

function getProjectSnapshot() {
  return {
    projectId: state.currentProjectId,
    form: getFormData(),
    strategy: state.currentStrategy,
    selectedTitle: state.selectedTitle,
    draft: $("#draftEditor").value,
    reviewHtml: $("#reviewOutput").innerHTML,
    review: state.currentReview,
    socialHtml: {
      xhs: $("#xhsOutput").innerHTML,
      linkedin: $("#linkedinOutput").innerHTML,
    },
    social: state.currentSocial,
    approved: state.approved,
    user: {
      name: state.currentUser,
    },
    workflow: {
      strategyReady: state.strategyReady,
      draftReady: state.draftReady,
      reviewReady: state.reviewReady,
    },
    log: state.log,
    selectedKnowledge: getSelectedKnowledge(),
  };
}

function restoreProjectSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  const form = snapshot.form || {};
  $("#topic").value = form.topic || "";
  $("#category").value = form.category || "EB-5";
  $("#audience").value = form.audience || "留学生与专业人士";
  $("#channel").value = form.channel || "微信公众号";
  $("#styleProfile").value = form.styleProfile || "温勇公众号深度评论风格";
  $("#articleType").value = form.articleType || "政策风险深度拆解";
  const depthInput = document.querySelector(`input[name='depth'][value='${form.depth || "standard"}']`);
  if (depthInput) depthInput.checked = true;
  $("#legalRigor").value = form.legalRigor || 4;
  $("#legalRigorOut").textContent = $("#legalRigor").value;
  $("#newsTone").value = form.newsTone || 4;
  $("#newsToneOut").textContent = $("#newsTone").value;
  $("#antiAi").checked = Boolean(form.antiAi);
  $("#riskFirst").checked = Boolean(form.riskFirst);
  $("#wechatHook").checked = Boolean(form.wechatHook);
  $("#historicalTone").checked = Boolean(form.historicalTone);
  $("#sanguoTone").checked = Boolean(form.sanguoTone);
  $("#poemClose").checked = Boolean(form.poemClose);
  $("#materials").value = form.materials || "";

  state.currentProjectId = snapshot.projectId || state.currentProjectId;
  state.currentStrategy = snapshot.strategy || null;
  state.currentReview = snapshot.review || null;
  state.currentSocial = snapshot.social || null;
  state.selectedTitle = snapshot.selectedTitle || "";
  state.strategyReady = Boolean(snapshot.workflow?.strategyReady || snapshot.strategy);
  state.draftReady = Boolean(snapshot.workflow?.draftReady || snapshot.draft);
  state.reviewReady = Boolean(snapshot.workflow?.reviewReady || snapshot.reviewHtml);
  state.approved = Boolean(snapshot.approved);
  state.log = Array.isArray(snapshot.log) ? snapshot.log : [];

  if (state.currentStrategy) {
    renderStrategy(state.currentStrategy);
  }
  updateSelectedTitle(state.selectedTitle, { updateCustomInput: true });
  $("#draftEditor").value = snapshot.draft || "";
  if (snapshot.reviewHtml) {
    $("#reviewOutput").innerHTML = snapshot.reviewHtml;
  } else if (state.currentReview) {
    renderReview(state.currentReview);
  }
  if (state.currentSocial) {
    renderSocial(state.currentSocial);
  } else {
    if (snapshot.socialHtml?.xhs) {
      $("#xhsOutput").innerHTML = snapshot.socialHtml.xhs;
    }
    if (snapshot.socialHtml?.linkedin) {
      $("#linkedinOutput").innerHTML = snapshot.socialHtml.linkedin;
    }
  }
  $("#reviewDraftViewer").value = snapshot.draft || "";
  $("#approvalText").textContent = state.approved
    ? "稿件已完成律师批准，可进入发布或排版流程。"
    : "当前稿件尚未完成律师审阅。";
  updateMetrics();
  updateWorkflow();
  renderLog();
}

function renderSocial(result) {
  const cards = Array.isArray(result.xhs_cards) ? result.xhs_cards : [];
  $("#xhsOutput").innerHTML = cards.length
    ? `
      <div class="title-pill">${escapeHtml(result.xhs_title || "小红书卡片版")}</div>
      ${cards.map((card, index) => `
        <div class="xhs-card">
          <div class="xhs-card-number">CARD ${index + 1}</div>
          <h4>${escapeHtml(card.title || "")}</h4>
          <p>${escapeHtml(card.body || "")}</p>
          <div class="xhs-visual">视觉建议：${escapeHtml(card.visual_direction || "简洁信息图")}</div>
          <div class="xhs-visual">底部小字：${escapeHtml(card.footer || "具体情况请咨询律师。")}</div>
          <label class="xhs-image-prompt">
            图片生成 Prompt
            <textarea data-xhs-prompt-index="${index}" spellcheck="false">${escapeHtml(card.image_prompt || buildXhsImagePrompt(card, index, result))}</textarea>
          </label>
          <div class="inline-actions">
            <button class="mini-button" data-xhs-clear-generate="${index}" type="button">生成清晰文字卡片</button>
            <button class="mini-button" data-xhs-image-generate="${index}" type="button">生成这张图片</button>
            ${card.image_url ? `<a class="mini-button" href="${escapeHtml(toAbsoluteUrl(card.image_url))}" target="_blank" rel="noreferrer">打开图片</a>` : ""}
            ${card.clear_svg_url ? `<a class="mini-button" href="${card.clear_svg_url}" download="xhs-card-${index + 1}.svg">下载SVG</a><button class="mini-button" data-xhs-clear-png="${index}" type="button">下载PNG</button>` : ""}
          </div>
          ${card.clear_svg_url ? `<div class="xhs-image-status">清晰文字卡片已生成：中文由浏览器真实字体渲染，不会出现 AI 乱码。</div>` : ""}
          ${card.image_url ? `<div class="xhs-image-status">图片已生成：<a href="${escapeHtml(toAbsoluteUrl(card.image_url))}" target="_blank" rel="noreferrer">${escapeHtml(toAbsoluteUrl(card.image_url))}</a></div>` : ""}
          <div class="xhs-image-preview" data-xhs-image-preview="${index}">
            ${card.clear_svg_url ? `<img src="${card.clear_svg_url}" alt="清晰文字小红书卡片 ${index + 1}" />` : card.image_url ? `<img src="${escapeHtml(toAbsoluteUrl(card.image_url))}" alt="小红书卡片 ${index + 1}" />` : ""}
          </div>
        </div>
      `).join("")}
      <div class="review-item">
        <strong>发布文案</strong>
        <p>${escapeHtml(result.xhs_caption || "")}</p>
      </div>
    `
    : '<p class="empty-state">本轮没有返回小红书卡片。</p>';

  const hashtags = Array.isArray(result.linkedin_hashtags) ? result.linkedin_hashtags : [];
  $("#linkedinOutput").innerHTML = `
    <div class="title-pill">${escapeHtml(result.linkedin_title || "LinkedIn Post")}</div>
    <div class="linkedin-post">${escapeHtml(result.linkedin_post || "")}</div>
    <div class="hashtag-row">${hashtags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
  `;
}

function buildXhsImagePrompt(card, index, result = state.currentSocial || {}) {
  const stylePrompt = result.xhs_style_prompt
    ? `统一视觉风格：${result.xhs_style_prompt}\n\n`
    : "";
  return `${stylePrompt}请生成一张小红书竖版 3:4 中文信息卡片，适合律所公众号文章二次分发。

卡片编号：${index + 1}
卡片标题：${card.title || ""}
卡片正文：${card.body || ""}
底部小字：${card.footer || "一般信息分享，不构成个案法律意见"}
视觉方向：${card.visual_direction || "简洁、专业、克制的信息图风格"}

设计要求：
- 画面必须是完整可发布的单张小红书图片，不要生成多张拼图。
- 中文文字要清晰可读，标题层级明显，正文不要拥挤。
- 保留较大留白，适合手机屏幕阅读。
- 不要使用夸张营销风、红色恐慌风、卡通幼稚风。
- 不要加入二维码、联系方式、律师头像或虚构 logo。
- 如文字太多，优先保持标题和核心句准确，正文可做专业排版摘要。`;
}

function updateXhsCardPrompt(index, prompt) {
  if (!state.currentSocial || !Array.isArray(state.currentSocial.xhs_cards)) return;
  const card = state.currentSocial.xhs_cards[index];
  if (!card) return;
  card.image_prompt = prompt;
}

async function generateXhsImage(index, button) {
  if (!state.currentSocial || !Array.isArray(state.currentSocial.xhs_cards)) {
    showToast("请先生成小红书卡片脚本");
    return;
  }
  const card = state.currentSocial.xhs_cards[index];
  if (!card) {
    showToast("找不到这张卡片");
    return;
  }
  const promptInput = $(`[data-xhs-prompt-index="${index}"]`);
  const prompt = promptInput?.value?.trim() || buildXhsImagePrompt(card, index);
  if (!prompt) {
    showToast("请先填写图片 prompt");
    return;
  }
  updateXhsCardPrompt(index, prompt);
  const restore = setBusy(button, "生成图片中...");
  try {
    const result = await apiPost("/api/images/generate", {
      prompt,
      size: "1024x1536",
      quality: "medium",
    });
    card.image_prompt = prompt;
    card.image_url = result.imageUrl;
    card.image_path = result.imagePath;
    card.image_model = result.model;
    const absoluteImageUrl = toAbsoluteUrl(result.imageUrl);
    const imageUrlWithBust = `${absoluteImageUrl}${absoluteImageUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const preview = $(`[data-xhs-image-preview="${index}"]`);
    if (preview) {
      preview.innerHTML = `<img src="${escapeHtml(imageUrlWithBust)}" alt="小红书卡片 ${index + 1}" />`;
    }
    renderSocial(state.currentSocial);
    const refreshedPreview = $(`[data-xhs-image-preview="${index}"]`);
    refreshedPreview?.scrollIntoView({ behavior: "smooth", block: "center" });
    addLog(`生成小红书图片：CARD ${index + 1}`);
    showToast(`CARD ${index + 1} 图片已生成，可点“打开图片”查看`);
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

function updateSelectedTitle(title, options = {}) {
  state.selectedTitle = String(title || "").trim();
  $("#selectedTitleText").textContent = state.selectedTitle || "尚未选择标题。";
  if (options.updateCustomInput) {
    $("#customTitle").value = state.selectedTitle;
  }
  $$(".title-option").forEach((button) => {
    button.classList.toggle("selected", button.dataset.title === state.selectedTitle);
  });
}

function renderStrategy(strategy) {
  const structure = Array.isArray(strategy.structure) ? strategy.structure : [];
  const risks = Array.isArray(strategy.risks) ? strategy.risks : [];
  const notes = Array.isArray(strategy.agent_notes) ? strategy.agent_notes : [];
  const titles = Array.isArray(strategy.titles) ? strategy.titles : [];
  const factChecks = Array.isArray(strategy.fact_check_targets) ? strategy.fact_check_targets : [];
  const followups = Array.isArray(strategy.followup_article_ideas) ? strategy.followup_article_ideas : [];

  $("#strategyOutput").innerHTML = `
    <div class="strategy-card">
      <h4>核心论点</h4>
      <p>${escapeHtml(strategy.thesis || "")}</p>
    </div>
    <div class="strategy-card">
      <h4>推荐类型</h4>
      <p>${escapeHtml(strategy.article_type || "按当前文章类型生成")}</p>
    </div>
    <div class="strategy-card">
      <h4>建议结构</h4>
      <ul>${structure.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="strategy-card">
      <h4>风险与补强点</h4>
      <ul>${risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="strategy-card">
      <h4>开篇方向</h4>
      <p>${escapeHtml(strategy.opening_direction || "")}</p>
    </div>
    <div class="strategy-card">
      <h4>助理操作提示</h4>
      <ul>${notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="strategy-card">
      <h4>发布前事实核验</h4>
      <ul>${factChecks.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>核验官方来源、日期、政策状态和适用边界。</li>"}</ul>
    </div>
    <div class="strategy-card">
      <h4>后续选题</h4>
      <ul>${followups.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>可围绕同一政策变化继续拆分客户行动建议。</li>"}</ul>
    </div>
  `;

  if (!state.selectedTitle && titles.length) {
    state.selectedTitle = titles[0];
  }

  $("#titleOutput").innerHTML = titles.length
    ? titles.map((title) => `<button class="title-pill title-option ${title === state.selectedTitle ? "selected" : ""}" data-title="${escapeHtml(title)}" type="button">${escapeHtml(title)}</button>`).join("")
    : '<p class="empty-state">本轮没有返回标题建议。</p>';
  updateSelectedTitle(state.selectedTitle, { updateCustomInput: true });
}

async function generateStrategy(event) {
  const restore = setBusy(event.currentTarget, "生成中...");
  try {
    const result = await apiPost("/api/articles/strategy", {
      form: getFormData(),
      knowledge: getSelectedKnowledge(),
    });
    state.currentStrategy = result;
    state.selectedTitle = "";
    renderStrategy(result);
    state.strategyReady = true;
    updateWorkflow();
    addLog("调用 Strategy Agent 生成文章策略");
    showToast("真实 AI 策略已生成");
    switchSection("strategy");
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

async function ensureStrategy() {
  if (state.strategyReady && state.currentStrategy) return state.currentStrategy;
  const result = await apiPost("/api/articles/strategy", {
    form: getFormData(),
    knowledge: getSelectedKnowledge(),
  });
  state.currentStrategy = result;
  renderStrategy(result);
  state.strategyReady = true;
  updateWorkflow();
  addLog("自动调用 Strategy Agent 生成文章策略");
  return result;
}

async function generateDraft(event) {
  const restore = setBusy(event.currentTarget, "写作中...");
  try {
    const strategy = await ensureStrategy();
    const result = await apiPost("/api/articles/draft", {
      form: getFormData(),
      strategy,
      selectedTitle: state.selectedTitle,
      knowledge: getSelectedKnowledge(),
    });
    $("#draftEditor").value = result.draft || "";
    if (Array.isArray(result.editor_notes) && result.editor_notes.length) {
      addLog(`Draft Agent 提醒：${result.editor_notes[0]}`);
    }
    state.draftReady = true;
    updateWorkflow();
    addLog("调用 Draft Writer Agent 生成初稿");
    showToast("真实 AI 初稿已生成");
    switchSection("draft");
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

async function applyDraftAction(action, button, customInstruction = "") {
  const editor = $("#draftEditor");
  if (!editor.value.trim()) {
    showToast("请先生成或输入草稿");
    return;
  }

  const restore = setBusy(button, "改稿中...");
  try {
    const result = await apiPost("/api/articles/rewrite", {
      action,
      actionLabel: actionLabels[action],
      customInstruction,
      form: getFormData(),
      strategy: state.currentStrategy,
      selectedTitle: state.selectedTitle,
      draft: editor.value,
      knowledge: getSelectedKnowledge(),
    });
    editor.value = result.draft || editor.value;
    if (Array.isArray(result.change_notes) && result.change_notes.length) {
      addLog(`${actionLabels[action] || "自定义微调"}：${result.change_notes[0]}`);
    }
    state.reviewReady = true;
    updateWorkflow();
    addLog(`调用 Rewrite Agent：${actionLabels[action] || "自定义微调"}`);
    showToast("真实 AI 改稿已完成");
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

async function applyCustomRewrite(event) {
  const instruction = $("#customRewrite").value.trim();
  if (!instruction) {
    showToast("请先输入自定义调整要求");
    return;
  }
  await applyDraftAction("custom", event.currentTarget, instruction);
}

function renderReview(review) {
  const groups = [
    ["核心判断", review.executive_summary || review.approval_gate],
    ["必须核验", review.must_check || review.fact_checks],
    ["主要风险", review.key_risks || review.legal_risks],
    ["发布建议", review.go_live_notes || review.publishing_suggestions],
  ];
  $("#reviewOutput").innerHTML = groups
    .map(([title, value]) => {
      const list = Array.isArray(value) ? value.slice(0, 4) : [value].filter(Boolean);
      return `
        <div class="review-item">
          <strong>${escapeHtml(title)}</strong>
          <ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>无明显高层问题。</li>"}</ul>
        </div>
      `;
    })
    .join("");
}

async function generateReview(event) {
  const editor = $("#draftEditor");
  if (!editor.value.trim()) {
    showToast("请先生成或输入草稿");
    return;
  }

  const restore = setBusy(event.currentTarget, "审阅中...");
  try {
    const result = await apiPost("/api/articles/review", {
      form: getFormData(),
      strategy: state.currentStrategy,
      selectedTitle: state.selectedTitle,
      draft: editor.value,
      knowledge: getSelectedKnowledge(),
    });
    renderReview(result);
    $("#reviewDraftViewer").value = editor.value;
    state.currentReview = result;
    state.reviewReady = true;
    updateWorkflow();
    addLog("调用 Final Partner Review Agent 生成审阅清单");
    showToast("真实 AI 审阅清单已生成");
    switchSection("review");
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

async function generateSocial(event) {
  const editor = $("#draftEditor");
  if (!editor.value.trim()) {
    showToast("请先生成或输入草稿");
    return;
  }

  const restore = setBusy(event.currentTarget, "生成中...");
  try {
    const result = await apiPost("/api/articles/social", {
      form: getFormData(),
      strategy: state.currentStrategy,
      selectedTitle: state.selectedTitle,
      draft: editor.value,
      review: state.currentReview,
      knowledge: getSelectedKnowledge(),
    });
    state.currentSocial = result;
    renderSocial(result);
    addLog("生成小红书卡片版和 LinkedIn 文章版");
    showToast("多平台版本已生成");
    switchSection("social");
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

function loadAttorneyFinal(options = {}) {
  const { resetProject = true, resetSocial = true } = options;
  const data = getFinalImportData();
  if (!data.article) {
    showToast("请先粘贴律师定稿");
    return null;
  }

  $("#topic").value = data.title;
  $("#category").value = data.form.category;
  $("#audience").value = data.form.audience;
  $("#channel").value = data.form.channel;
  $("#styleProfile").value = data.form.styleProfile;
  $("#articleType").value = "定稿多平台改写";
  const standardDepth = document.querySelector("input[name='depth'][value='standard']");
  if (standardDepth) standardDepth.checked = true;
  $("#legalRigor").value = data.form.legalRigor;
  $("#legalRigorOut").textContent = data.form.legalRigor;
  $("#newsTone").value = data.form.newsTone;
  $("#newsToneOut").textContent = data.form.newsTone;
  $("#antiAi").checked = true;
  $("#riskFirst").checked = true;
  $("#wechatHook").checked = true;
  $("#historicalTone").checked = false;
  $("#sanguoTone").checked = false;
  $("#poemClose").checked = false;
  $("#materials").value = data.form.materials;

  updateSelectedTitle(data.title, { updateCustomInput: true });
  $("#draftEditor").value = data.article;
  $("#reviewDraftViewer").value = data.article;
  $("#approvalText").textContent = "律师定稿已导入，可直接进入多平台发布素材生成。";

  if (resetProject) {
    state.currentProjectId = null;
  }
  state.currentStrategy = null;
  state.currentReview = {
    executive_summary: ["律师定稿导入，未改写正文。"],
    must_check: ["发布前仍由律师确认事实、日期和免责声明。"],
    key_risks: ["多平台版本不得改变原文法律判断。"],
    go_live_notes: ["可生成小红书卡片、LinkedIn 英文版并保存版本。"],
  };
  if (resetSocial) {
    state.currentSocial = null;
    $("#xhsOutput").innerHTML = '<p class="empty-state">点击“生成小红书 / LinkedIn”后，这里会显示小红书图片卡片内容。</p>';
    $("#linkedinOutput").innerHTML = '<p class="empty-state">LinkedIn 版本会在这里生成。</p>';
  }
  state.strategyReady = false;
  state.draftReady = true;
  state.reviewReady = true;
  state.approved = true;
  renderReview(state.currentReview);
  updateMetrics();
  updateWorkflow();
  addLog("导入律师定稿");
  showToast("律师定稿已载入");
  return data;
}

async function generateSocialFromFinal(event) {
  const data = loadAttorneyFinal();
  if (!data) return;
  const restore = setBusy(event.currentTarget, "生成中...");
  try {
    const result = await apiPost("/api/articles/social", {
      form: getFormData(),
      strategy: {
        thesis: "基于律师定稿进行多平台改写，不改变原文结论。",
        article_type: "律师定稿多平台分发",
      },
      selectedTitle: state.selectedTitle,
      draft: data.article,
      review: state.currentReview,
      knowledge: getSelectedKnowledge(),
    });
    state.currentSocial = result;
    renderSocial(result);
    addLog("基于律师定稿生成小红书卡片和 LinkedIn 版本");
    showToast("定稿多平台版本已生成");
    switchSection("social");
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

async function saveAttorneyFinalProject(event) {
  const incoming = getFinalImportData();
  const alreadyLoaded =
    incoming.article &&
    $("#draftEditor").value.trim() === incoming.article &&
    state.selectedTitle === incoming.title;
  const data = alreadyLoaded
    ? loadAttorneyFinal({ resetProject: false, resetSocial: false })
    : loadAttorneyFinal({ resetProject: true, resetSocial: true });
  if (!data) return;
  const restore = setBusy(event.currentTarget, "保存中...");
  try {
    await saveProject("律师定稿导入");
  } finally {
    restore();
  }
}

function renderExtractedKnowledge(result) {
  const item = result.item || {};
  $("#finalKnowledgeOutput").innerHTML = `
    <div class="review-item">
      <strong>${escapeHtml(item.title || "已保存知识库规则")}</strong>
      <p>${escapeHtml(String(item.content || "").slice(0, 700))}${String(item.content || "").length > 700 ? "..." : ""}</p>
    </div>
  `;
}

async function extractKnowledgeFromFinal(event) {
  const data = getFinalImportData();
  if (!data.article) {
    showToast("请先粘贴律师定稿");
    return;
  }
  const restore = setBusy(event.currentTarget, "提炼中...");
  try {
    const result = await apiPost("/api/knowledge/extract", {
      title: data.title,
      category: data.form.category,
      audience: data.form.audience,
      styleProfile: data.form.styleProfile,
      article: data.article,
    });
    renderExtractedKnowledge(result);
    await loadKnowledge();
    addLog("从律师定稿提炼知识库规则");
    showToast("已保存为知识库规则");
  } catch (error) {
    showToast(error.message);
  } finally {
    restore();
  }
}

function approveArticle() {
  const role = $("#roleSelect").value;
  if (role !== "attorney" && role !== "admin") {
    showToast("只有律师或管理员可以批准发布");
    return;
  }
  state.approved = true;
  $("#approvalText").textContent = "稿件已完成律师批准，可进入发布或排版流程。";
  updateWorkflow();
  addLog("律师批准发布");
  showToast("已批准发布");
}

async function saveProject(reason = "手动保存") {
  try {
    const result = await apiPost("/api/projects/save", {
      projectId: state.currentProjectId,
      userName: state.currentUser,
      reason,
      snapshot: getProjectSnapshot(),
    });
    state.currentProjectId = result.project.id;
    await loadProjects();
    addLog(`保存版本：${reason}`);
    showToast("项目版本已保存");
    return result;
  } catch (error) {
    showToast(error.message);
    return null;
  }
}

function renderProjects() {
  const container = $("#projectList");
  if (!state.projects.length) {
    container.innerHTML = '<p class="empty-state">暂无已保存项目。</p>';
    return;
  }
  container.innerHTML = state.projects
    .map((project) => `
      <div class="project-item">
        <h4>${escapeHtml(project.title)}</h4>
        <div class="project-meta">${escapeHtml(project.category || "未分类")} · ${escapeHtml(project.audience || "未设定读者")} · ${project.versionCount} 个版本 · 最近：${escapeHtml(project.latestActor || project.owner || "未记录")}</div>
        <div class="inline-actions">
          <button class="mini-button" data-project-load="${escapeHtml(project.id)}" type="button">加载最新</button>
          <button class="mini-button" data-project-versions="${escapeHtml(project.id)}" type="button">查看版本</button>
        </div>
      </div>
    `)
    .join("");
}

function renderVersions(projectId, versions) {
  const container = $("#versionList");
  if (!versions.length) {
    container.innerHTML = '<p class="empty-state">这个项目还没有版本。</p>';
    return;
  }
  container.innerHTML = versions
    .slice()
    .reverse()
    .map((version) => `
      <div class="version-item">
        <h4>${escapeHtml(version.reason || "保存版本")}</h4>
        <div class="project-meta">${escapeHtml(version.createdAt || "")} · ${escapeHtml(version.actor || "未记录")}</div>
        <button class="mini-button" data-version-load="${escapeHtml(projectId)}:${escapeHtml(version.id)}" type="button">恢复此版本</button>
      </div>
    `)
    .join("");
}

async function loadProjects() {
  try {
    const result = await apiGet("/api/projects");
    state.projects = result.projects || [];
    renderProjects();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadProject(projectId, versionId = null) {
  try {
    const result = await apiPost("/api/projects/load", { projectId, versionId });
    state.currentProjectId = result.project.id;
    restoreProjectSnapshot(result.version.snapshot);
    renderVersions(projectId, result.versions || []);
    addLog(versionId ? "恢复历史版本" : "加载项目最新版本");
    showToast(versionId ? "历史版本已恢复" : "项目已加载");
    switchSection("draft");
  } catch (error) {
    showToast(error.message);
  }
}

async function showProjectVersions(projectId) {
  try {
    const result = await apiPost("/api/projects/load", { projectId });
    renderVersions(projectId, result.versions || []);
  } catch (error) {
    showToast(error.message);
  }
}

function renderKnowledge() {
  const container = $("#knowledgeList");
  if (!state.knowledgeItems.length) {
    container.innerHTML = '<p class="empty-state">暂无知识库素材。</p>';
    return;
  }
  container.innerHTML = state.knowledgeItems
    .map((item) => `
      <div class="knowledge-item">
        <h4><label><input class="knowledge-check" type="checkbox" value="${escapeHtml(item.id)}" /> ${escapeHtml(item.title)}</label></h4>
        <div class="knowledge-meta">${escapeHtml(item.sourceType || "note")} · ${escapeHtml(item.createdAt || "")} · ${item.content.length} 字符</div>
        <p>${escapeHtml(item.content.slice(0, 180))}${item.content.length > 180 ? "..." : ""}</p>
      </div>
    `)
    .join("");
}

async function loadKnowledge() {
  try {
    const result = await apiGet("/api/knowledge");
    state.knowledgeItems = result.items || [];
    renderKnowledge();
  } catch (error) {
    showToast(error.message);
  }
}

async function saveKnowledge() {
  const title = $("#knowledgeTitle").value.trim() || "未命名素材";
  const content = $("#knowledgeContent").value.trim();
  if (!content) {
    showToast("请先粘贴或上传素材内容");
    return;
  }
  try {
    await apiPost("/api/knowledge/save", { title, content, sourceType: "user-note" });
    $("#knowledgeContent").value = "";
    await loadKnowledge();
    showToast("知识库素材已保存");
  } catch (error) {
    showToast(error.message);
  }
}

function injectKnowledge() {
  const selected = getSelectedKnowledge();
  if (!selected.length) {
    showToast("请先勾选知识库素材");
    return;
  }
  const addition = selected
    .map((item) => `\n\n【知识库：${item.title}】\n${item.content.slice(0, 4000)}`)
    .join("");
  $("#materials").value = `${$("#materials").value.trim()}${addition}`;
  addLog(`注入知识库素材：${selected.length} 项`);
  showToast("已注入到材料区");
  switchSection("workspace");
}

function handleKnowledgeFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    $("#knowledgeTitle").value = file.name;
    $("#knowledgeContent").value = String(reader.result || "");
    showToast("文件内容已读入，可保存到知识库");
  };
  reader.onerror = () => showToast("文件读取失败");
  reader.readAsText(file, "utf-8");
}

function exportDraft() {
  const data = getFormData();
  const content = $("#draftEditor").value.trim() || "当前没有可导出的草稿。";
  const strategy = $("#strategyOutput").innerText.trim();
  const text = `# ${state.selectedTitle || data.topic}\n\n## 文章参数\n类别：${data.category}\n读者：${data.audience}\n渠道：${data.channel}\n选中标题：${state.selectedTitle || "未选择"}\n写作风格：${data.styleProfile}\n文章类型：${data.articleType}\n法律严谨度：${data.legalRigor}\n新闻评论感：${data.newsTone}\n\n## 文章策略\n${strategy}\n\n## 草稿\n${content}\n`;
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${data.topic.replace(/[\\/:*?"<>|]/g, "-")}.md`;
  link.click();
  URL.revokeObjectURL(url);
  addLog("导出 Markdown 稿件");
  showToast("稿件已导出");
}

function resetApp() {
  state.strategyReady = false;
  state.draftReady = false;
  state.reviewReady = false;
  state.approved = false;
  state.currentProjectId = null;
  state.currentStrategy = null;
  state.currentReview = null;
  state.currentSocial = null;
  $("#strategyOutput").innerHTML = '<p class="empty-state">点击“生成文章策略”后，这里会显示核心论点、结构、风险提示和补强方向。</p>';
  $("#titleOutput").innerHTML = '<p class="empty-state">标题建议会随策略一并生成。</p>';
  updateSelectedTitle("", { updateCustomInput: true });
  $("#customRewrite").value = "";
  $("#draftEditor").value = "";
  $("#reviewOutput").innerHTML = '<p class="empty-state">点击“生成审阅清单”后，这里会显示简洁的律师高层审阅意见。</p>';
  $("#reviewDraftViewer").value = "";
  $("#approvalText").textContent = "当前稿件尚未完成律师审阅。";
  $("#xhsOutput").innerHTML = '<p class="empty-state">点击“生成小红书 / LinkedIn”后，这里会显示小红书图片卡片内容。</p>';
  $("#linkedinOutput").innerHTML = '<p class="empty-state">LinkedIn 版本会在这里生成。</p>';
  updateWorkflow();
  addLog("重置当前项目");
  showToast("已重置");
}

async function checkApiStatus() {
  const status = $("#apiStatus");
  const box = status.closest(".api-box");
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    state.authRequired = Boolean(data.authRequired);
    state.authenticated = Boolean(data.authenticated || !data.authRequired);
    state.currentUser = data.userName || localStorage.getItem("ia_user_name") || "本机用户";
    updateUserNote();
    box.classList.toggle("error", !data.apiKeyConfigured);
    const lanText = Array.isArray(data.lanUrls) && data.lanUrls.length
      ? ` 局域网：${data.lanUrls[0]}`
      : "";
    const authText = data.authRequired
      ? data.authenticated
        ? ` 已登录：${state.currentUser}`
        : " 等待内测登录"
      : " 本机免登录";
    status.textContent = data.apiKeyConfigured
      ? `已连接本地后端，模型：${data.model}。${authText}${lanText}`
      : `后端已启动，但未设置 OPENAI_API_KEY。模型：${data.model}`;
    if (data.authRequired && !data.authenticated) {
      showLogin("请输入内测访问密码。");
      return false;
    }
    hideLogin();
    return true;
  } catch (error) {
    box.classList.add("error");
    status.textContent = "未连接到本地 AI 后端，请用 server.py 启动。";
    showLogin("本地后端未连接，请先启动 server.py。");
    return false;
  }
}

async function loginBeta(event) {
  event.preventDefault();
  const userName = $("#loginUserName").value.trim() || "内测成员";
  const password = $("#loginPassword").value;
  const button = event.currentTarget.querySelector("button");
  const restore = setBusy(button, "登录中...");
  try {
    const result = await apiPost("/api/login", { userName, password });
    state.authenticated = Boolean(result.authenticated);
    state.currentUser = result.userName || userName;
    localStorage.setItem("ia_user_name", state.currentUser);
    $("#loginPassword").value = "";
    hideLogin();
    updateUserNote();
    await checkApiStatus();
    await loadProjects();
    await loadKnowledge();
    addLog(`内测登录：${state.currentUser}`);
    showToast("已进入内测版");
  } catch (error) {
    $("#loginError").textContent = error.message;
  } finally {
    restore();
  }
}

async function logoutBeta() {
  try {
    await apiPost("/api/logout", {});
  } catch (error) {
    // Even if the server is unreachable, clear local state so the UI returns to login.
  }
  state.authenticated = false;
  showLogin("已退出登录。");
  updateUserNote();
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", loginBeta);
  $("#logoutBtn").addEventListener("click", logoutBeta);
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => switchSection(item.dataset.section)));
  $("#roleSelect").addEventListener("change", (event) => {
    $("#roleNote").textContent = roleNotes[event.target.value];
    addLog(`切换角色：${event.target.options[event.target.selectedIndex].text}`);
  });
  $("#generateStrategyBtn").addEventListener("click", generateStrategy);
  $("#generateDraftBtn").addEventListener("click", generateDraft);
  $("#strategyDraftBtn").addEventListener("click", generateDraft);
  $("#titleOutput").addEventListener("click", (event) => {
    const button = event.target.closest?.(".title-option");
    if (!button) return;
    updateSelectedTitle(button.dataset.title, { updateCustomInput: true });
    addLog("选择策略标题");
  });
  $("#customTitle").addEventListener("input", (event) => updateSelectedTitle(event.target.value));
  $("#reviewBtn").addEventListener("click", generateReview);
  $("#socialBtn").addEventListener("click", generateSocial);
  $("#finalLoadBtn").addEventListener("click", () => {
    if (loadAttorneyFinal()) switchSection("draft");
  });
  $("#finalSocialBtn").addEventListener("click", generateSocialFromFinal);
  $("#finalSaveBtn").addEventListener("click", saveAttorneyFinalProject);
  $("#finalKnowledgeBtn").addEventListener("click", extractKnowledgeFromFinal);
  $("#xhsOutput").addEventListener("input", (event) => {
    const promptInput = event.target.closest?.("[data-xhs-prompt-index]");
    if (!promptInput) return;
    updateXhsCardPrompt(Number(promptInput.dataset.xhsPromptIndex), promptInput.value);
  });
  $("#xhsOutput").addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-xhs-image-generate]");
    const clearButton = event.target.closest?.("[data-xhs-clear-generate]");
    const pngButton = event.target.closest?.("[data-xhs-clear-png]");
    if (button) {
      generateXhsImage(Number(button.dataset.xhsImageGenerate), button);
    }
    if (clearButton) {
      generateClearTextCard(Number(clearButton.dataset.xhsClearGenerate), clearButton);
    }
    if (pngButton) {
      downloadClearTextPng(Number(pngButton.dataset.xhsClearPng));
    }
  });
  $("#customRewriteBtn").addEventListener("click", applyCustomRewrite);
  $("#approveBtn").addEventListener("click", approveArticle);
  $("#saveProjectBtn").addEventListener("click", () => saveProject("顶部保存"));
  $("#librarySaveBtn").addEventListener("click", () => saveProject("项目库保存"));
  $("#refreshProjectsBtn").addEventListener("click", loadProjects);
  $("#saveKnowledgeBtn").addEventListener("click", saveKnowledge);
  $("#injectKnowledgeBtn").addEventListener("click", injectKnowledge);
  $("#knowledgeFile").addEventListener("change", handleKnowledgeFile);
  $("#projectList").addEventListener("click", (event) => {
    const loadButton = event.target.closest?.("[data-project-load]");
    const versionsButton = event.target.closest?.("[data-project-versions]");
    const loadId = loadButton?.dataset?.projectLoad;
    const versionsId = versionsButton?.dataset?.projectVersions;
    if (loadId) loadProject(loadId);
    if (versionsId) {
      showProjectVersions(versionsId);
      $("#versionList")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  $("#versionList").addEventListener("click", (event) => {
    const versionButton = event.target.closest?.("[data-version-load]");
    const value = versionButton?.dataset?.versionLoad;
    if (!value) return;
    const [projectId, versionId] = value.split(":");
    loadProject(projectId, versionId);
  });
  $("#exportBtn").addEventListener("click", exportDraft);
  $("#resetBtn").addEventListener("click", resetApp);
  $$(".tool-button").forEach((button) => {
    button.addEventListener("click", () => applyDraftAction(button.dataset.action, button));
  });
  ["legalRigor", "newsTone"].forEach((id) => {
    const input = $(`#${id}`);
    const output = $(`#${id}Out`);
    input.addEventListener("input", () => {
      output.textContent = input.value;
      updateMetrics();
    });
  });
  $$("input[name='depth']").forEach((input) => input.addEventListener("change", updateMetrics));
  $("#category").addEventListener("change", updateMetrics);
  $("#riskFirst").addEventListener("change", updateMetrics);
}

async function initialize() {
  bindEvents();
  updateWorkflow();
  updateMetrics();
  updateUserNote();
  const ready = await checkApiStatus();
  if (ready) {
    await loadProjects();
    await loadKnowledge();
  }
  addLog("创建文章项目");
}

initialize();
