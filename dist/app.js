const API_HOST =
  window.POOHTER_API_HOST ||
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://api.poohter.com");
const API_BASE = `${API_HOST}/api`;
const ASSET_BASE = API_BASE.replace("/api", "");

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

const api = async (path, options = {}) => {
  const headers = options.headers ? { ...options.headers } : {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || "Request failed");
  return data;
};

const money = (value) => `Rs ${Math.round(Number(value || 0)).toLocaleString()}`;
const uploadUrl = (path) => {
  if (!path) return "";
  if (String(path).startsWith("http")) return path;
  return `${ASSET_BASE}/${String(path).replace(/^uploads[\\/]/, "uploads/").replace(/\\/g, "/")}`;
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
    .map(([label, value]) => `<div class="profile-item"><span>${label}</span><strong>${value || "Not provided"}</strong></div>`)
    .join("");
};

const renderMetrics = () => {
  const pending = state.orders.filter((order) => order.status === "approved_by_admin").length;
  const paid = state.payouts.reduce((sum, payout) => sum + Number(payout.amount || 0), 0);
  $("#productCount").textContent = state.products.length;
  $("#orderCount").textContent = state.orders.length;
  $("#pendingCount").textContent = pending;
  $("#paidTotal").textContent = money(paid);
};

const renderProducts = () => {
  $("#productsList").innerHTML = state.products.length
    ? state.products
        .map((product) => {
          const image = uploadUrl(product.image_url);
          return `
            <article class="product-card">
              <div class="product-media">${image ? `<img src="${image}" alt="${product.name}" />` : `<span>W</span>`}</div>
              <div class="product-card-body">
                <div>
                  <span class="muted">${product.product_uid || `Wholesale #${product.id}`}</span>
                  <h3>${product.name}</h3>
                  <p>${product.description || "No description provided."}</p>
                </div>
                <div class="card-meta">
                  <span>${money(product.wholesale_price)}</span>
                  <span>Min ${product.min_order_quantity}</span>
                  <span>${product.available_stock} stock</span>
                  <span>${product.status}</span>
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
            <td><strong>${order.order_code}</strong><span>${order.linked_product_uid || "Product ID after acceptance"}</span></td>
            <td><strong>${order.seller_shop || order.seller_name}</strong><span>${order.seller_phone || order.seller_email}</span></td>
            <td><strong>${order.product_name}</strong><span>${order.quantity} x ${money(order.wholesale_unit_price)}</span></td>
            <td><strong>${money(order.total_price)}</strong></td>
            <td><span class="badge ${order.status}">${wholesaleStatusLabel(order.status)}</span></td>
            <td>
              <div class="row-actions">
                ${order.status === "approved_by_admin" ? `<button class="mini-btn" data-accept="${order.id}">Accept</button><button class="outline-btn" data-reject="${order.id}">Reject</button>` : ""}
                ${order.status === "accepted" ? `<button class="mini-btn" data-pdf="${order.id}">PDF</button>` : ""}
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
            <td><strong>${payout.payout_code}</strong><span>${payout.status}</span></td>
            <td>${payout.order_code}</td>
            <td><strong>${money(payout.amount)}</strong></td>
            <td>${payout.method || "Instant wholesale payment"}</td>
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

on("#loginMode", "click", () => {
  $("#loginMode").classList.add("active");
  $("#signupMode").classList.remove("active");
  $("#loginForm").classList.remove("hidden");
  $("#signupForm").classList.add("hidden");
});

on("#signupMode", "click", () => {
  $("#signupMode").classList.add("active");
  $("#loginMode").classList.remove("active");
  $("#signupForm").classList.remove("hidden");
  $("#loginForm").classList.add("hidden");
});

on("#loginForm", "submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/wholesaler/login", {
      method: "POST",
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
  const formData = new FormData(event.currentTarget);
  if (!formData.get("cnic_front")?.size) formData.delete("cnic_front");
  if (!formData.get("cnic_back")?.size) formData.delete("cnic_back");
  try {
    await api("/wholesaler/register", { method: "POST", body: formData });
    event.currentTarget.reset();
    $("#loginMode").click();
    showToast("Registration sent. Admin approval is required before login.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

on("#productForm", "submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const images = formData.getAll("product_images").filter((file) => file && file.size);
  if (images.length < 5) {
    showToast("Minimum 5 photos of wholesale product are required", "error");
    return;
  }
  try {
    await api("/wholesaler/products", { method: "POST", body: formData });
    form.reset();
    await loadDashboard();
    showToast("Wholesale product published", "success");
  } catch (error) {
    showToast(error.message, "error");
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

showApp(Boolean(state.token));
if (state.token) loadDashboard();
