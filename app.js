const API_HOST = (window.EXPO_PUBLIC_API_URL || "https://api.poohter.com").replace(/\/+$/, "");
const API_BASE = API_HOST.endsWith("/api") ? API_HOST : `${API_HOST}/api`;
const API_BASES = [...new Set([API_BASE, "https://api.poohter.com/api"])];
const ASSET_BASE = API_BASE.replace("/api", "");
const REQUEST_TIMEOUT_MS = 25000;

const readJsonStorage = (key, fallback = null) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
};

const state = {
  token: localStorage.getItem("poohterWholesalerToken") || "",
  wholesaler: readJsonStorage("poohterWholesaler"),
  profile: null,
  products: [],
  orders: [],
  payouts: [],
  signupStep: 1,
  signupOtpPending: false,
  resetOtpSent: false,
  otpTimers: {},
  otpResends: { signup: 0, reset: 0 },
};

const $ = (selector) => document.querySelector(selector);
const on = (selector, eventName, handler) => {
  const element = $(selector);
  if (element) element.addEventListener(eventName, handler);
};
const toast = $("#toast");

const showToast = (message, type = "") => {
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => (toast.className = "toast"), 3200);
};

const showSignupAlert = (type, title, message) => {
  const alert = $("#signupAlert");
  if (!alert) return;
  alert.className = `form-alert ${type}`;
  alert.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
};

const hideSignupAlert = () => {
  const alert = $("#signupAlert");
  if (!alert) return;
  alert.className = "form-alert hidden";
  alert.textContent = "";
};

const showAuthMode = (mode) => {
  $("#loginMode").classList.toggle("active", mode === "login");
  $("#signupMode").classList.toggle("active", mode === "signup");
  $("#loginForm").classList.toggle("hidden", mode !== "login");
  $("#signupForm").classList.toggle("hidden", mode !== "signup");
  $("#resetForm").classList.toggle("hidden", mode !== "reset");
};

const setSignupStep = (step) => {
  state.signupStep = Math.max(1, Math.min(4, step));
  document.querySelectorAll("[data-signup-step]").forEach((section) => {
    section.classList.toggle("active", Number(section.dataset.signupStep) === state.signupStep);
  });
  document.querySelectorAll("[data-step-pill]").forEach((pill) => {
    const pillStep = Number(pill.dataset.stepPill);
    pill.classList.toggle("active", pillStep === state.signupStep);
    pill.classList.toggle("completed", pillStep < state.signupStep);
  });
  $("#signupPrev").classList.toggle("hidden", state.signupStep === 1 || state.signupOtpPending);
  $("#signupNext").classList.toggle("hidden", state.signupStep === 4 || state.signupOtpPending);
  $("#signupSubmit").classList.toggle("hidden", state.signupStep !== 4);
};

const validateSignupStep = () => {
  const section = document.querySelector(`[data-signup-step="${state.signupStep}"]`);
  if (!section) return true;

  if (state.signupStep === 1) {
    const password = $("#signupForm input[name='password']");
    const confirmPassword = $("#signupForm input[name='confirmPassword']");
    if (password.value !== confirmPassword.value) {
      showToast("Passwords do not match.", "error");
      confirmPassword.focus();
      return false;
    }
  }

  const fields = Array.from(section.querySelectorAll("input, textarea, select"));
  const invalid = fields.find((field) => !field.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    return false;
  }
  return true;
};

const setSignupOtpMode = (enabled) => {
  const wasEnabled = state.signupOtpPending;
  state.signupOtpPending = enabled;
  $("#signupOtpPanel").classList.toggle("hidden", !enabled);
  const otpInput = $("#signupOtpPanel input[name='otp']");
  if (otpInput) otpInput.required = enabled;
  if (enabled) setSignupStep(4);
  if (enabled && !wasEnabled) startOtpCooldown("signup");
  $("#signupSubmit").textContent = enabled ? "Verify Email & Submit" : "Submit For Admin Approval";
  setSignupStep(state.signupStep);
};

const setResetOtpMode = (enabled) => {
  const wasEnabled = state.resetOtpSent;
  state.resetOtpSent = enabled;
  $("#resetOtpPanel").classList.toggle("hidden", !enabled);
  $("#resetSubmit").textContent = enabled ? "Change Password" : "Send Reset Code";
  $("#resetOtpPanel").querySelectorAll("input").forEach((input) => {
    input.required = enabled;
  });
  if (enabled && !wasEnabled) startOtpCooldown("reset");
};

const startOtpCooldown = (kind, seconds = 60) => {
  const button = kind === "signup" ? $("#signupResendOtp") : $("#resetResendOtp");
  if (!button) return;
  clearInterval(state.otpTimers[kind]);
  let remaining = seconds;
  button.disabled = true;
  button.textContent = `Resend OTP in ${remaining}s`;
  state.otpTimers[kind] = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(state.otpTimers[kind]);
      const used = state.otpResends[kind] || 0;
      button.disabled = used >= 5;
      button.textContent = used >= 5 ? "Resend limit reached" : `Resend OTP (${used}/5)`;
      return;
    }
    button.textContent = `Resend OTP in ${remaining}s`;
  }, 1000);
};

const resendOtp = async (kind) => {
  const email = kind === "signup"
    ? $("#signupForm input[name='email']").value
    : $("#resetForm input[name='email']").value;
  if (!email) return showToast("Enter your email before resending OTP.", "error");
  if ((state.otpResends[kind] || 0) >= 5) return showToast("OTP resend limit reached.", "error");
  const button = kind === "signup" ? $("#signupResendOtp") : $("#resetResendOtp");
  button.disabled = true;
  button.textContent = "Resending...";
  try {
    await api("/auth/otp/resend", {
      method: "POST",
      auth: false,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        accountType: "wholesaler",
        purpose: kind === "signup" ? "signup" : "password_reset",
      }),
    });
    state.otpResends[kind] = (state.otpResends[kind] || 0) + 1;
    showToast("A new OTP has been sent to your email.", "success");
    startOtpCooldown(kind);
  } catch (error) {
    showToast(error.message, "error");
    startOtpCooldown(kind, 5);
  }
};

const requestTimeoutMessage = (path) => (
  path.includes("/wholesaler/products")
    ? "Product publish is taking too long. Please check your connection and try again."
    : "Request is taking too long. Please try again."
);

const api = async (path, options = {}) => {
  const headers = options.headers ? { ...options.headers } : {};
  if (state.token && options.auth !== false) headers.Authorization = `Bearer ${state.token}`;
  const requestOptions = { ...options, headers };
  delete requestOptions.auth;
  const timeoutMs = Number(requestOptions.timeoutMs) || REQUEST_TIMEOUT_MS;
  delete requestOptions.timeoutMs;
  const externalSignal = requestOptions.signal;

  for (const [index, base] of API_BASES.entries()) {
    const isLastAttempt = index === API_BASES.length - 1;
    const controller = externalSignal ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(`${base}${path}`, {
        ...requestOptions,
        signal: externalSignal || controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data || {};
      if (response.status === 404 && !isLastAttempt) continue;
      throw new Error(data.error || data.message || "Request failed");
    } catch (error) {
      if (error.name === "AbortError") throw new Error(requestTimeoutMessage(path));
      if (!isLastAttempt && /Failed to fetch|NetworkError|Load failed/i.test(error.message || "")) continue;
      if (error.message && error.message !== "Failed to fetch") throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw new Error("Cannot connect to Poohter API. Please refresh the page and try again.");
};

const money = (value) => `Rs ${Math.round(Number(value || 0)).toLocaleString()}`;
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#039;",
}[character]));
const uploadUrl = (path) => {
  if (!path) return "";
  const cleanPath = String(path).trim();
  if (!cleanPath) return "";
  if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
  return `${ASSET_BASE}/${cleanPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^uploads\//, "uploads/")}`;
};

const pruneEmptyFiles = (formData, fieldName) => {
  const files = formData.getAll(fieldName).filter((file) => !(file instanceof File) || file.size > 0);
  formData.delete(fieldName);
  files.forEach((file) => formData.append(fieldName, file));
};

const translateTextToUrdu = async (text) => {
  const cleanText = String(text || "").trim();
  if (!cleanText) throw new Error("Enter the English product name first.");
  const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=en|ur`);
  const data = await response.json().catch(() => ({}));
  const translated = data?.responseData?.translatedText;
  if (!response.ok || !translated) throw new Error("Translation failed. Please type the Urdu name manually.");
  return translated;
};

const setSession = ({ token, wholesaler }) => {
  state.token = token;
  state.wholesaler = wholesaler;
  localStorage.setItem("poohterWholesalerToken", token);
  localStorage.setItem("poohterWholesaler", JSON.stringify(wholesaler));
};

const clearSession = () => {
  state.token = "";
  state.wholesaler = null;
  state.profile = null;
  state.products = [];
  state.orders = [];
  state.payouts = [];
  localStorage.removeItem("poohterWholesalerToken");
  localStorage.removeItem("poohterWholesaler");
};

const showApp = (isAuthed) => {
  $("#authScreen").classList.toggle("hidden", isAuthed);
  $("#appShell").classList.toggle("hidden", !isAuthed);
};

const pdfText = (value) =>
  String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const downloadPdf = (filename, title, lines) => {
  const contentLines = [
    "BT",
    "/F1 18 Tf",
    "50 780 Td",
    `(${pdfText(title)}) Tj`,
    "/F1 11 Tf",
    "0 -28 Td",
    ...lines.flatMap((line) => [`(${pdfText(line)}) Tj`, "0 -18 Td"]),
    "ET",
  ];
  const stream = contentLines.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const wholesaleStatusLabel = (status) => {
  const labels = {
    admin_review: "Admin review",
    approved_by_admin: "Ready to accept",
    accepted: "Accepted",
    rejected: "Rejected",
  };
  return labels[status] || status || "Admin review";
};

const receiptLines = (order = {}) => [
  `Wholesale Order: ${order.order_code || order.id || "Not available"}`,
  `Generated Product ID: ${order.linked_product_uid || "Generated after acceptance"}`,
  `Receipt Code: ${order.linked_receipt_code || "Generated after acceptance"}`,
  `Product: ${order.product_name || "Not available"}`,
  `Quantity: ${order.quantity || 0}`,
  `Wholesale Unit Price: ${money(order.wholesale_unit_price)}`,
  `Total Wholesale Payment: ${money(order.total_price)}`,
  `Seller: ${order.seller_shop || order.seller_name || "Not available"}`,
  `Seller ID: ${order.seller_public_id || order.seller_id || "Not available"}`,
  `Wholesaler: ${order.wholesaler_shop || order.wholesaler_name || "Not available"}`,
  `Wholesaler Phone: ${order.wholesaler_phone || ""}`,
  "Send this physical stock to the Poohter warehouse with this receipt.",
];

const receiptQrPayload = (order = {}) => JSON.stringify({
  type: "poohter_wholesale_receipt",
  order_code: order.order_code || order.id || "",
  order_id: order.id || "",
  wholesale_order_id: order.id || "",
  product_uid: order.linked_product_uid || "",
  product_id: order.linked_product_id || "",
  receipt_code: order.linked_receipt_code || "",
  receipt_id: order.linked_receipt_code || "",
  quantity: Number(order.quantity || 0),
});

const receiptQrUrl = (order = {}, size = 220) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=12&data=${encodeURIComponent(receiptQrPayload(order))}`;

const receiptTableRows = (order = {}) => [
  ["Wholesale Order", order.order_code || order.id || "Not available"],
  ["Generated Product ID", order.linked_product_uid || "Generated after acceptance"],
  ["Receipt Code", order.linked_receipt_code || "Generated after acceptance"],
  ["Product", order.product_name || "Not available"],
  ["Quantity", order.quantity || 0],
  ["Wholesale Unit Price", money(order.wholesale_unit_price)],
  ["Total Wholesale Payment", money(order.total_price)],
  ["Seller", order.seller_shop || order.seller_name || "Not available"],
  ["Seller ID", order.seller_public_id || order.seller_id || "Not available"],
  ["Wholesaler", order.wholesaler_shop || order.wholesaler_name || "Not available"],
  ["Wholesaler Phone", order.wholesaler_phone || ""],
];

const receiptHtml = (order = {}) => {
  const receiptCode = order.linked_receipt_code || order.order_code || "wholesale-receipt";
  const productUid = order.linked_product_uid || "Generated after acceptance";
  const printedAt = new Date().toLocaleString();
  const rows = receiptTableRows(order).map(([label, value]) => `
    <tr>
      <th>${escapeHtml(label)}</th>
      <td>${escapeHtml(value)}</td>
    </tr>
  `).join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(receiptCode)}</title>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 28px; background: #f3f4f6; color: #111827; font-family: Arial, Helvetica, sans-serif; }
        .receipt { max-width: 760px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; overflow: hidden; }
        .top { display: flex; justify-content: space-between; gap: 20px; padding: 28px 32px; background: #0f4e63; color: #fff; border-bottom: 10px solid #f59e0b; }
        .brand { font-size: 30px; font-weight: 900; letter-spacing: 1px; }
        .subtitle { margin-top: 4px; color: #dbeafe; font-size: 14px; font-weight: 700; }
        .status { align-self: flex-start; background: #ecfdf5; color: #047857; border-radius: 999px; padding: 10px 14px; font-size: 12px; font-weight: 900; }
        .hero { display: flex; justify-content: space-between; gap: 28px; padding: 28px 32px; border-bottom: 1px solid #e5e7eb; }
        .label { color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 900; margin-bottom: 6px; }
        .code { font-size: 28px; font-weight: 900; margin-bottom: 20px; }
        .uid { font-size: 22px; font-weight: 900; color: #0f766e; }
        .qr { text-align: center; min-width: 190px; border: 1px solid #e5e7eb; border-radius: 16px; padding: 14px; background: #fff; }
        .qr img { width: 160px; height: 160px; display: block; }
        .qr span { display: block; margin-top: 8px; color: #64748b; font-size: 11px; font-weight: 800; }
        .instruction { margin: 24px 32px; padding: 16px; border-radius: 14px; background: #eff6ff; color: #1d4ed8; font-weight: 800; }
        table { width: calc(100% - 64px); margin: 0 32px 28px; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #e5e7eb; padding: 12px; text-align: left; font-size: 13px; }
        th { width: 38%; color: #0f4e63; background: #f8fafc; font-weight: 900; }
        td { color: #334155; font-weight: 700; }
        .footer { padding: 0 32px 28px; color: #64748b; font-size: 12px; }
        @media print {
          body { background: #fff; padding: 0; }
          .receipt { border-radius: 0; border: 0; max-width: none; }
        }
      </style>
    </head>
    <body>
      <main class="receipt">
        <section class="top">
          <div>
            <div class="brand">POOHTER</div>
            <div class="subtitle">Wholesale warehouse receipt</div>
          </div>
          <div class="status">WAREHOUSE HANDOFF</div>
        </section>
        <section class="hero">
          <div>
            <div class="label">Receipt code</div>
            <div class="code">${escapeHtml(receiptCode)}</div>
            <div class="label">Generated product ID</div>
            <div class="uid">${escapeHtml(productUid)}</div>
          </div>
          <div class="qr">
            <img src="${receiptQrUrl(order)}" alt="Receipt QR code" />
            <span>Scan at warehouse</span>
          </div>
        </section>
        <div class="instruction">Send this physical stock to the Poohter warehouse with this receipt attached.</div>
        <table><tbody>${rows}</tbody></table>
        <div class="footer">Printed: ${escapeHtml(printedAt)}. The QR code contains the wholesale order, generated product ID, receipt code, and quantity.</div>
      </main>
    </body>
  </html>`;
};

const downloadReceipt = (orderId) => {
  const order = state.orders.find((item) => String(item.id) === String(orderId) || String(item.order_code) === String(orderId));
  if (!order) {
    showToast("Receipt is available after accepting an admin-approved order", "error");
    return;
  }
  downloadPdf(`${order.linked_receipt_code || order.order_code || "wholesale-receipt"}.pdf`, "Poohter Wholesale Warehouse Receipt", [
    "A Trust Where Quality Matters",
    ...receiptLines(order),
    `Generated: ${new Date().toLocaleString()}`,
    `QR Payload: ${receiptQrPayload(order)}`,
  ]);
  showToast("Receipt PDF downloaded", "success");
};

const renderProfile = () => {
  const profile = state.profile?.wholesaler || state.wholesaler || {};
  $("#shopTitle").textContent = profile.shop_name || profile.name || "Poohter Wholesaler";
  $("#shopSubtitle").textContent = profile.email ? `${profile.email} - ${profile.city || "Wholesale account"}` : "Connected to Poohter backend";
  $("#accountStatus").textContent = profile.status
    ? `Account status: ${String(profile.status).replace(/_/g, " ")}`
    : "Wholesaler profile connected";
  if (profile.cnic_update_status === "requested" || profile.cnic_update_status === "rejected") {
    $("#accountStatus").textContent = "Account status: CNIC update required";
  } else if (profile.cnic_update_status === "uploaded") {
    $("#accountStatus").textContent = "Account status: CNIC update waiting for admin review";
  }
  $("#wholesalerAvatar").textContent = (profile.shop_name || profile.name || "P").charAt(0).toUpperCase();
  const fields = [
    ["Owner", profile.name],
    ["Shop", profile.shop_name],
    ["Email", profile.email],
    ["Phone", profile.phone],
    ["City", profile.city],
    ["Business", profile.business_type],
    ["Warehouse", profile.warehouse_address],
    ["Bank", profile.bank_name],
    ["Account", profile.account_title || profile.account_number],
    ["Wallet", profile.mobile_wallet],
    ["Status", profile.status],
    ["CNIC Update", cnicUpdateLabel(profile)],
  ];
  $("#profileGrid").innerHTML = fields
    .map(([label, value]) => `<div class="profile-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not provided")}</strong></div>`)
    .join("");
  const form = $("#cnicUpdateForm");
  if (form) {
    const required = ["requested", "rejected"].includes(profile.cnic_update_status);
    form.classList.toggle("hidden", !required);
    $("#cnicUpdateMessage").textContent = profile.cnic_update_rejection_reason || profile.cnic_update_note || "Upload clear front and back CNIC images for admin review.";
  }
};

const cnicUpdateLabel = (profile = {}) => {
  if (profile.cnic_update_status === "requested") return "CNIC update required";
  if (profile.cnic_update_status === "uploaded") return "Uploaded, waiting for admin review";
  if (profile.cnic_update_status === "rejected") return `Rejected - ${profile.cnic_update_rejection_reason || "upload again"}`;
  if (profile.cnic_update_status === "approved") return "Latest update approved";
  return "Clear";
};

const renderMetrics = () => {
  const pending = state.orders.filter((order) => order.status === "approved_by_admin").length;
  const paid = state.payouts.reduce((sum, payout) => sum + Number(payout.amount || 0), 0);
  $("#productCount").textContent = state.products.length;
  $("#orderCount").textContent = state.orders.length;
  $("#pendingCount").textContent = pending;
  $("#attentionCount").textContent = pending;
  $("#paidTotal").textContent = money(paid);
};

const renderProducts = () => {
  $("#productsList").innerHTML = state.products.length
    ? state.products
        .map((product) => {
          const image = uploadUrl(product.image_url);
          const nextStatus = product.status === "paused" ? "active" : "paused";
          return `
            <article class="product-card">
              <div class="product-media">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" />` : `<span>W</span>`}</div>
              <div class="product-card-body">
                <div>
                  <span class="muted">${escapeHtml(product.product_uid || `Wholesale #${product.id}`)}</span>
                  <h3>${escapeHtml(product.name)}</h3>
                  <p>${escapeHtml(product.description || "No description provided.")}</p>
                </div>
                <div class="card-meta">
                  <span>${money(product.wholesale_price)}</span>
                  <span>Min ${Number(product.min_order_quantity || 0)}</span>
                  <span>${Number(product.available_stock || 0)} stock</span>
                  <span>${escapeHtml(product.status || "active")}</span>
                </div>
                <div class="product-actions">
                  <button class="outline-btn" type="button" data-toggle-product="${product.id}" data-next-status="${nextStatus}">
                    ${nextStatus === "active" ? "Activate" : "Pause"}
                  </button>
                </div>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty">No wholesale products yet. Add your first supply product below.</div>`;
  document.querySelectorAll(".product-media img").forEach((image) => {
    image.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.textContent = "W";
      image.replaceWith(fallback);
    }, { once: true });
  });
};

const renderOrders = () => {
  $("#ordersList").innerHTML = state.orders.length
    ? state.orders
        .map((order) => `
          <tr>
            <td><strong>${escapeHtml(order.order_code)}</strong><span>${escapeHtml(order.linked_product_uid || "Product ID after acceptance")}</span></td>
            <td><strong>${escapeHtml(order.seller_shop || order.seller_name || "Seller")}</strong><span>${escapeHtml(order.seller_phone || order.seller_email || "")}</span></td>
            <td><strong>${escapeHtml(order.product_name || "Product")}</strong><span>${Number(order.quantity || 0)} x ${money(order.wholesale_unit_price)}</span></td>
            <td><strong>${money(order.total_price)}</strong></td>
            <td><span class="badge ${escapeHtml(order.status)}">${escapeHtml(wholesaleStatusLabel(order.status))}</span></td>
            <td>
              <div class="row-actions">
                ${order.status === "approved_by_admin" ? `<button class="mini-btn" type="button" data-accept="${order.id}">Accept</button><button class="outline-btn" type="button" data-reject="${order.id}">Reject</button>` : ""}
                ${order.status === "accepted" ? `<button class="mini-btn" type="button" data-pdf="${order.id}">PDF</button>` : ""}
              </div>
            </td>
          </tr>
        `)
        .join("")
    : `<tr><td colspan="6"><div class="empty">No seller requests yet.</div></td></tr>`;
};

const renderPayouts = () => {
  $("#payoutsList").innerHTML = state.payouts.length
    ? state.payouts
        .map((payout) => `
          <tr>
            <td><strong>${escapeHtml(payout.payout_code)}</strong><span>${escapeHtml(payout.status || "paid")}</span></td>
            <td>${escapeHtml(payout.order_code || "")}</td>
            <td><strong>${money(payout.amount)}</strong></td>
            <td>${escapeHtml(payout.method || "Instant wholesale payment")}</td>
            <td>${payout.paid_at ? new Date(payout.paid_at).toLocaleDateString() : "Paid"}</td>
          </tr>
        `)
        .join("")
    : `<tr><td colspan="5"><div class="empty">No instant payouts yet.</div></td></tr>`;
};

const renderAll = () => {
  renderProfile();
  renderMetrics();
  renderOrders();
  renderProducts();
  renderPayouts();
};

const loadDashboard = async () => {
  if (!state.token) return;
  try {
    const [profile, products, orders, payouts] = await Promise.all([
      api("/wholesaler/profile"),
      api("/wholesaler/products"),
      api("/wholesaler/orders"),
      api("/wholesaler/payouts"),
    ]);
    state.profile = profile;
    state.products = Array.isArray(products) ? products : [];
    state.orders = Array.isArray(orders) ? orders : [];
    state.payouts = Array.isArray(payouts) ? payouts : [];
    renderAll();
  } catch (error) {
    showToast(error.message, "error");
    if (error.message.toLowerCase().includes("invalid") || error.message.toLowerCase().includes("approval")) {
      clearSession();
      showApp(false);
    }
  }
};

on("#loginMode", "click", () => showAuthMode("login"));

on("#signupMode", "click", () => {
  setSignupOtpMode(false);
  setSignupStep(1);
  showAuthMode("signup");
});

on("#forgotPassword", "click", () => {
  $("#resetForm input[name='email']").value = $("#loginForm input[name='email']").value;
  setResetOtpMode(false);
  showAuthMode("reset");
});

on("#resetBack", "click", () => showAuthMode("login"));

on("#signupNext", "click", () => {
  if (validateSignupStep()) setSignupStep(state.signupStep + 1);
});

on("#signupPrev", "click", () => {
  setSignupStep(state.signupStep - 1);
});

on("#loginForm", "submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/wholesaler/login", {
      method: "POST",
      auth: false,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    setSession(result);
    showApp(true);
    await loadDashboard();
    showToast("Login successful", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

on("#signupForm", "submit", async (event) => {
  event.preventDefault();
  if (!state.signupOtpPending && state.signupStep < 4) {
    if (validateSignupStep()) setSignupStep(state.signupStep + 1);
    return;
  }
  if (!state.signupOtpPending && !validateSignupStep()) return;
  const form = event.currentTarget;
  hideSignupAlert();
  const submitButton = $("#signupSubmit");
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = state.signupOtpPending ? "Verifying..." : "Sending OTP...";
  const formData = new FormData(form);
  if (!formData.get("cnic_front")?.size) formData.delete("cnic_front");
  if (!formData.get("cnic_back")?.size) formData.delete("cnic_back");
  try {
    const result = state.signupOtpPending
      ? await api("/wholesaler/register/verify", {
        method: "POST",
        auth: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email"),
          otp: formData.get("otp"),
        }),
      })
      : await api("/wholesaler/register", { method: "POST", auth: false, body: formData });
    if (result.requiresOtp) {
      setSignupOtpMode(true);
      state.otpResends.signup = 0;
      showSignupAlert("success", "Verification code sent", result.message || "Check your email for the OTP.");
      showToast("OTP sent to your email", "success");
      return;
    }
    form.reset();
    setSignupOtpMode(false);
    showSignupAlert(
      "success",
      "Registration submitted successfully",
      result.message || "Your wholesaler account has been sent for admin approval. Please wait until the Poohter admin team approves your account before logging in."
    );
    showToast("Registration sent for admin approval", "success");
  } catch (error) {
    const message = error.message || "Registration failed. Please check your details and try again.";
    showSignupAlert("error", "Registration could not be completed", message);
    showToast(message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = state.signupOtpPending ? "Verify Email & Submit" : originalText;
  }
});

on("#resetForm", "submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submitButton = $("#resetSubmit");
  submitButton.disabled = true;
  submitButton.textContent = state.resetOtpSent ? "Changing..." : "Sending...";
  try {
    const email = form.get("email");
    if (!state.resetOtpSent) {
      const result = await api("/auth/password/forgot", {
        method: "POST",
        auth: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, accountType: "wholesaler" }),
      });
      setResetOtpMode(true);
      state.otpResends.reset = 0;
      showToast(result.message || "Reset OTP sent to your email.", "success");
      return;
    }
    if (form.get("password") !== form.get("confirmPassword")) {
      showToast("Passwords do not match.", "error");
      return;
    }
    const result = await api("/auth/password/reset", {
      method: "POST",
      auth: false,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        accountType: "wholesaler",
        otp: form.get("otp"),
        password: form.get("password"),
        confirmPassword: form.get("confirmPassword"),
      }),
    });
    event.currentTarget.reset();
    setResetOtpMode(false);
    showAuthMode("login");
    showToast(result.message || "Password changed. Please login.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    submitButton.disabled = false;
    setResetOtpMode(state.resetOtpSent);
  }
});

on("#signupResendOtp", "click", () => resendOtp("signup"));
on("#resetResendOtp", "click", () => resendOtp("reset"));

on("#translateProductName", "click", async (event) => {
  const button = event.currentTarget;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Translating...";
  try {
    const translated = await translateTextToUrdu($("#productNameInput").value);
    $("#productUrduNameInput").value = translated;
    showToast("Product name translated to Urdu", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

on("#cnicUpdateForm", "submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    const data = await api("/wholesaler/cnic-update", { method: "POST", body: formData });
    form.reset();
    await loadDashboard();
    showToast(data.message || "CNIC images uploaded for admin review", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

on("#productForm", "submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter || form.querySelector("button[type='submit']");
  const formData = new FormData(form);
  pruneEmptyFiles(formData, "product_images");
  const price = Number(formData.get("wholesale_price"));
  const minOrder = Number.parseInt(formData.get("min_order_quantity"), 10);
  const stock = Number.parseInt(formData.get("available_stock"), 10);
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(minOrder) || minOrder < 1 || !Number.isInteger(stock) || stock < minOrder) {
    showToast("Price, a positive minimum order, and stock at least equal to minimum order are required", "error");
    return;
  }
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Sending for review...";
  }
  try {
    await api("/wholesaler/products", { method: "POST", body: formData, timeoutMs: 30000 });
    form.reset();
    showToast("Wholesale product sent for admin review", "success");
    loadDashboard().catch((error) => showToast(`Sent for review, but refresh failed: ${error.message}`, "error"));
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Submit For Admin Review";
    }
  }
});

on("#ordersList", "click", async (event) => {
  const accept = event.target.closest("[data-accept]");
  const reject = event.target.closest("[data-reject]");
  const pdf = event.target.closest("[data-pdf]");
  if (pdf) {
    downloadReceipt(pdf.dataset.pdf);
    return;
  }
  const id = accept?.dataset.accept || reject?.dataset.reject;
  if (!id) return;
  const button = accept || reject;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = accept ? "Accepting..." : "Rejecting...";
  try {
    if (accept) {
      const result = await api(`/wholesaler/orders/${id}/accept`, { method: "POST" });
      const existingOrder = state.orders.find((order) => String(order.id) === String(id) || String(order.order_code) === String(id));
      const acceptedOrder = {
        ...(existingOrder || {}),
        ...((result?.order && typeof result.order === "object") ? result.order : {}),
      };
      state.orders = state.orders.map((order) => String(order.id) === String(id) || String(order.order_code) === String(id) ? acceptedOrder : order);
      downloadReceipt(acceptedOrder.id || acceptedOrder.order_code);
      await loadDashboard();
      showToast("Order accepted and receipt PDF downloaded", "success");
    } else {
      await api(`/wholesaler/orders/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Wholesaler rejected this request" }),
      });
      await loadDashboard();
      showToast("Order rejected", "success");
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

on("#productsList", "click", async (event) => {
  const button = event.target.closest("[data-toggle-product]");
  if (!button) return;
  const product = state.products.find((item) => String(item.id) === String(button.dataset.toggleProduct));
  if (!product) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = button.dataset.nextStatus === "active" ? "Activating..." : "Pausing...";
  try {
    await api(`/wholesaler/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: product.name,
        name_urdu: product.name_urdu || "",
        description: product.description || "",
        wholesale_price: product.wholesale_price,
        min_order_quantity: product.min_order_quantity,
        available_stock: product.available_stock,
        status: button.dataset.nextStatus,
      }),
    });
    await loadDashboard();
    showToast(`Product ${button.dataset.nextStatus === "active" ? "activated" : "paused"}`, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

on("#refreshBtn", "click", loadDashboard);
on("#logoutBtn", "click", () => {
  clearSession();
  showApp(false);
  showToast("Logged out");
});

document.querySelectorAll(".nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

function mountPoohterContactWidget() {
  const mount = document.querySelector(".poohter-contact-widget");
  if (!mount || mount.dataset.ready === "true") return;
  mount.dataset.ready = "true";
  const accountType = mount.dataset.accountType || window.POOHTER_ACCOUNT_TYPE || "wholesaler";
  const phoneNumber = window.POOHTER_WHATSAPP_NUMBER || "923000000000";
  const whatsappText = encodeURIComponent(`Hello Poohter, I need help with my ${accountType} account.`);
  mount.innerHTML = `
    <style>.poohter-contact-widget{position:fixed;right:18px;bottom:18px;z-index:80;display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;justify-content:flex-end}.poohter-contact-widget button,.poohter-contact-widget a{border:0;border-radius:8px;min-height:44px;padding:0 14px;font:inherit;font-weight:900;text-decoration:none;display:inline-flex;align-items:center;gap:8px;box-shadow:0 12px 24px rgba(15,23,42,.18);cursor:pointer}.poohter-contact-widget .call-btn{background:#0f172a;color:#fff}.poohter-contact-widget .wa-btn{background:#16a34a;color:#fff}.poohter-contact-form{position:fixed;right:18px;bottom:76px;width:min(340px,calc(100vw - 36px));background:#fff;border:1px solid #dbe3ef;border-radius:8px;padding:14px;box-shadow:0 20px 48px rgba(15,23,42,.2);display:none;gap:10px}.poohter-contact-form.open{display:grid}.poohter-contact-form input,.poohter-contact-form textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit}.poohter-contact-form textarea{min-height:74px;resize:vertical}.poohter-contact-form .form-row{display:flex;gap:8px}@media(max-width:560px){.poohter-contact-widget{left:12px;right:12px}.poohter-contact-widget button,.poohter-contact-widget a{flex:1;justify-content:center}.poohter-contact-form{left:12px;right:12px;width:auto}}</style>
    <form class="poohter-contact-form"><input name="phone" placeholder="03XXXXXXXXX" required /><textarea name="message" placeholder="Message optional"></textarea><div class="form-row"><button class="call-btn" type="submit">Send Request</button><button class="call-btn" type="button" data-close-contact>Close</button></div></form>
    <button class="call-btn" type="button" data-open-contact>Request Call</button><a class="wa-btn" href="https://wa.me/${phoneNumber}?text=${whatsappText}" target="_blank" rel="noreferrer">WhatsApp</a>`;
  const form = mount.querySelector(".poohter-contact-form");
  mount.querySelector("[data-open-contact]").addEventListener("click", () => form.classList.toggle("open"));
  mount.querySelector("[data-close-contact]").addEventListener("click", () => form.classList.remove("open"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/support/request-call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: form.phone.value, message: form.message.value, account_type: accountType, source: "website", name: state?.wholesaler?.name || "" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not send request");
      form.reset(); form.classList.remove("open"); showToast("Call request sent.", "success");
    } catch (error) { showToast(error.message, "error"); }
  });
}

mountPoohterContactWidget();
setSignupStep(1);
showApp(Boolean(state.token));
if (state.token) loadDashboard();
