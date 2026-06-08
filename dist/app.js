const API_HOST = (window.EXPO_PUBLIC_API_URL || "https://api.poohter.com").replace(/\/+$/, "");
const API_BASE = API_HOST.endsWith("/api") ? API_HOST : `${API_HOST}/api`;
const API_BASES = [...new Set([API_BASE, "https://api.poohter.com/api"])];
const ASSET_BASE = API_BASE.replace("/api", "");
const REQUEST_TIMEOUT_MS = 25000;
const SIGNUP_REQUEST_TIMEOUT_MS = 90000;
const SIGNUP_MAX_FILE_BYTES = 5.5 * 1024 * 1024;

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
  resetOtpSent: false,
  otpTimers: {},
  otpResends: { reset: 0 },
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
  $("#signupPrev").classList.toggle("hidden", state.signupStep === 1);
  $("#signupNext").classList.toggle("hidden", state.signupStep === 4);
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

const setResetOtpMode = (enabled) => {
  const wasEnabled = state.resetOtpSent;
  state.resetOtpSent = enabled;
  $("#resetOtpPanel").classList.toggle("hidden", !enabled);
  $("#resetSubmit").textContent = enabled ? "Change Password" : "Send Reset Code";
  $("#resetOtpPanel").querySelectorAll("input").forEach((input) => {
    input.required = enabled;
  });
  if (enabled && !wasEnabled) startResetOtpCooldown();
};

const startResetOtpCooldown = (seconds = 60) => {
  const kind = "reset";
  const button = $("#resetResendOtp");
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

const resendResetOtp = async () => {
  const kind = "reset";
  const email = $("#resetForm input[name='email']").value;
  if (!email) return showToast("Enter your email before resending OTP.", "error");
  if ((state.otpResends[kind] || 0) >= 5) return showToast("OTP resend limit reached.", "error");
  const button = $("#resetResendOtp");
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
        purpose: "password_reset",
      }),
    });
    state.otpResends[kind] = (state.otpResends[kind] || 0) + 1;
    showToast("A new OTP has been sent to your email.", "success");
    startResetOtpCooldown();
  } catch (error) {
    showToast(error.message, "error");
    startResetOtpCooldown(5);
  }
};

const requestTimeoutMessage = (path) => (
  path.includes("/wholesaler/register")
    ? "Registration is still being submitted. Please check your connection and try again in a moment."
    : path.includes("/wholesaler/products")
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
      if (response.ok) return data;
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
  if (String(path).startsWith("http")) return path;
  return `${ASSET_BASE}/${String(path).replace(/^uploads[\\/]/, "uploads/").replace(/\\/g, "/")}`;
};

const pruneEmptyFiles = (formData, fieldName) => {
  const files = formData.getAll(fieldName).filter((file) => !(file instanceof File) || file.size > 0);
  formData.delete(fieldName);
  files.forEach((file) => formData.append(fieldName, file));
};

const fileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;

const mergeSelectedFiles = (input) => {
  if (input.dataset.fileKind === "video" || !input.multiple || typeof DataTransfer === "undefined") return;
  const maxFiles = Number(input.dataset.maxFiles || 0);
  const currentFiles = input._poohterFiles || [];
  const nextFiles = Array.from(input.files || []);
  const merged = [];
  const seen = new Set();
  [...currentFiles, ...nextFiles].forEach((file) => {
    const key = fileKey(file);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(file);
  });
  const finalFiles = maxFiles > 0 ? merged.slice(0, maxFiles) : merged;
  const transfer = new DataTransfer();
  finalFiles.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input._poohterFiles = finalFiles;
};

const setInputFiles = (input, files) => {
  if (typeof DataTransfer === "undefined") return;
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input._poohterFiles = files;
};

const updateSelectedFileList = (input) => {
  const list = input.dataset.fileList ? $(`#${input.dataset.fileList}`) : null;
  if (!list) return;
  const files = Array.from(input.files || []);
  if (!files.length) {
    list.textContent = "No images selected";
    return;
  }
  const names = files.map((file) => file.name);
  const joinedNames = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  list.innerHTML = `
    <strong>${escapeHtml(joinedNames)} ${files.length === 1 ? "image is" : "images are"} added.</strong>
    ${files.map((file, index) => `
      <span class="selected-file-item">
        <span>Image ${index + 1}: ${escapeHtml(file.name)} added</span>
        <button type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">Remove</button>
      </span>
    `).join("")}
  `;
};

document.addEventListener("change", (event) => {
  const input = event.target.closest("input[type='file'][data-file-list]");
  if (input) {
    mergeSelectedFiles(input);
    updateSelectedFileList(input);
  }
});

document.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-file]");
  if (!removeButton) return;
  const list = removeButton.closest("[id]");
  if (!list) return;
  const input = document.querySelector(`input[type='file'][data-file-list='${list.id}']`);
  if (!input) return;
  const removeIndex = Number(removeButton.dataset.removeFile);
  const files = Array.from(input.files || []).filter((_, index) => index !== removeIndex);
  setInputFiles(input, files);
  updateSelectedFileList(input);
});

const validateSignupUploads = (formData) => {
  for (const fieldName of ["cnic_front", "cnic_back"]) {
    const file = formData.get(fieldName);
    if (file instanceof File && file.size > SIGNUP_MAX_FILE_BYTES) {
      throw new Error("CNIC files must be under 5.5 MB each. Please upload smaller JPG, PNG, or PDF files or submit without CNIC files for now.");
    }
  }
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

const receiptLines = (order) => [
  `Wholesale Order: ${order.order_code}`,
  `Generated Product ID: ${order.linked_product_uid}`,
  `Receipt Code: ${order.linked_receipt_code}`,
  `Product: ${order.product_name}`,
  `Quantity: ${order.quantity}`,
  `Wholesale Unit Price: ${money(order.wholesale_unit_price)}`,
  `Total Wholesale Payment: ${money(order.total_price)}`,
  `Seller: ${order.seller_shop || order.seller_name}`,
  `Seller ID: ${order.seller_public_id || order.seller_id}`,
  `Wholesaler: ${order.wholesaler_shop || order.wholesaler_name}`,
  `Wholesaler Phone: ${order.wholesaler_phone || ""}`,
  "Send this physical stock to the Poohter warehouse with this receipt.",
];

const downloadReceipt = (orderId) => {
  const order = state.orders.find((item) => String(item.id) === String(orderId));
  if (!order?.linked_receipt_code) {
    showToast("Receipt is available after accepting an admin-approved order", "error");
    return;
  }
  downloadPdf(`${order.linked_receipt_code}.pdf`, "POOHTER WHOLESALE WAREHOUSE RECEIPT", receiptLines(order));
};

const renderProfile = () => {
  const profile = state.profile?.wholesaler || state.wholesaler || {};
  $("#shopTitle").textContent = profile.shop_name || profile.name || "Poohter Wholesaler";
  $("#shopSubtitle").textContent = profile.email ? `${profile.email} - ${profile.city || "Wholesale account"}` : "Connected to Poohter backend";
  const statusText = profile.status
    ? `Account status: ${String(profile.status).replace(/_/g, " ")}`
    : "Wholesaler profile connected";
  $("#accountStatus").textContent = statusText;
  const topStatus = $("#topAccountStatus");
  if (topStatus) topStatus.textContent = statusText;
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
  ];
  $("#profileGrid").innerHTML = fields
    .map(([label, value]) => `<div class="profile-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not provided")}</strong></div>`)
    .join("");
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
  if (state.signupStep < 4) {
    if (validateSignupStep()) setSignupStep(state.signupStep + 1);
    return;
  }
  if (!validateSignupStep()) return;
  const form = event.currentTarget;
  hideSignupAlert();
  const submitButton = $("#signupSubmit");
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";
  const formData = new FormData(form);
  if (!formData.get("cnic_front")?.size) formData.delete("cnic_front");
  if (!formData.get("cnic_back")?.size) formData.delete("cnic_back");
  try {
    validateSignupUploads(formData);
    const result = await api("/wholesaler/register", {
      method: "POST",
      auth: false,
      body: formData,
      timeoutMs: SIGNUP_REQUEST_TIMEOUT_MS,
    });
    form.reset();
    setSignupStep(1);
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
    submitButton.textContent = originalText;
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

on("#resetResendOtp", "click", resendResetOtp);

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

on("#productForm", "submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter || form.querySelector("button[type='submit']");
  const formData = new FormData(form);
  pruneEmptyFiles(formData, "product_images");
  const price = Number(formData.get("wholesale_price"));
  const minOrder = Number.parseInt(formData.get("min_order_quantity"), 10);
  const stock = Number.parseInt(formData.get("available_stock"), 10);
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(minOrder) || minOrder < 25 || !Number.isInteger(stock) || stock < minOrder) {
    showToast("Price, minimum order of at least 25, and stock at least equal to minimum order are required", "error");
    return;
  }
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Sending for review...";
  }
  try {
    await api("/wholesaler/products", { method: "POST", body: formData, timeoutMs: 30000 });
    form.reset();
    form.querySelectorAll("input[type='file'][data-file-list]").forEach((input) => {
      input._poohterFiles = [];
      updateSelectedFileList(input);
    });
    showToast("Wholesale product sent for admin review", "success");
    loadDashboard().catch((error) => showToast(`Sent for review, but refresh failed: ${error.message}`, "error"));
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Publish Wholesale Product";
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
      if (result.order?.linked_receipt_code) {
        state.orders = state.orders.map((order) => String(order.id) === String(id) ? result.order : order);
        downloadPdf(`${result.order.linked_receipt_code}.pdf`, "POOHTER WHOLESALE WAREHOUSE RECEIPT", result.receipt_lines || receiptLines(result.order));
      }
      await loadDashboard();
      showToast("Order accepted and paid instantly", "success");
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

setSignupStep(1);
showApp(Boolean(state.token));
if (state.token) loadDashboard();
