// ★★★ ご自身のGASウェブアプリURL ★★★
const GAS_URL = "https://script.google.com/macros/s/AKfycbzvkpbYbCp_2grTdcpxu8m5IOXrTGLSFhdJTXP8Z3BXKHWBNDMMBh2rcUx6VQHHX4Nq5g/exec";

const UNIT_PRICE = 500;

// 販売・会計の状態管理
let saleCountStr = "0";
let isSaleConfirmed = false;
let payReceivedStr = "0";
let currentTotalBilling = 0;
let isPayConfirmed = false;

// データ配列（販売データ / 削除履歴 / オフライン未送信キュー）
let orderHistory = JSON.parse(localStorage.getItem("pos_sales_data") || "[]");
let trashHistory = JSON.parse(localStorage.getItem("pos_trash_data") || "[]");
let offlineQueue = JSON.parse(localStorage.getItem("pos_offline_queue") || "[]");

let activeTab = "active";
let editingOrderId = null;

// ── 1. オンライン / オフライン状態監視 ＆ キュー自動同期 ──
async function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  const badges = document.querySelectorAll(".status-badge");

  badges.forEach(badge => {
    const textEl = badge.querySelector(".status-text");
    if (isOnline) {
      badge.className = "status-badge status-online";
      textEl.innerText = offlineQueue.length > 0 ? `オンライン (未同期 ${offlineQueue.length}件)` : "オンライン";
    } else {
      badge.className = "status-badge status-offline";
      textEl.innerText = `オフライン (未送信 ${offlineQueue.length}件)`;
    }
  });

  // オンライン復帰時は「未送信を送信」してから「スプシ最新化」
  if (isOnline && offlineQueue.length > 0) {
    await flushOfflineQueue();
    fetchFromGAS(false);
  }
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

async function flushOfflineQueue() {
  if (offlineQueue.length === 0 || !navigator.onLine) return;
  console.log("未送信キュー送信中...", offlineQueue.length, "件");

  const queueToSend = [...offlineQueue];
  for (const item of queueToSend) {
    try {
      await sendPostToGAS(item.action, item.payload);
      offlineQueue = offlineQueue.filter(q => q.id !== item.id);
      localStorage.setItem("pos_offline_queue", JSON.stringify(offlineQueue));
    } catch (err) {
      console.warn("キュー再送中断:", err);
      break;
    }
  }
  updateOnlineStatus();
}

// ── 2. 24時間時計 ──
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const str = `${h}:${m}:${s}`;
  document.querySelectorAll(".live-clock").forEach(el => el.innerText = str);
}
setInterval(updateClock, 1000);
updateClock();

// ── 3. テンキートレイ操作 ──
function toggleTray(trayId) {
  document.getElementById(trayId).classList.toggle("tray-collapsed");
}
function collapseTray(trayId) {
  const tray = document.getElementById(trayId);
  if (!tray.classList.contains("tray-collapsed")) tray.classList.add("tray-collapsed");
}
function setupSwipeDown(trayId) {
  const tray = document.getElementById(trayId);
  let startY = 0;
  tray.addEventListener("touchstart", e => { startY = e.touches[0].clientY; }, { passive: true });
  tray.addEventListener("touchend", e => {
    if (e.changedTouches[0].clientY - startY > 40) tray.classList.add("tray-collapsed");
  }, { passive: true });
}
setupSwipeDown("saleKeypadTray");
setupSwipeDown("checkoutKeypadTray");

// ── 4. 金券販売（枚数入力） ──
function openSaleScreen() {
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenSale").classList.add("active");
  clearInputSale();
  document.getElementById("saleKeypadTray").classList.remove("tray-collapsed");
}
function closeSaleScreen() {
  document.getElementById("screenSale").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}
function updateSaleDisplay() {
  document.getElementById("sheetCount").innerText = Number(saleCountStr).toLocaleString();
}
function inputNumSale(num) {
  if (isSaleConfirmed) resetSaleConfirmState();
  if (saleCountStr.length >= 3 && saleCountStr !== "0") return;
  saleCountStr = (saleCountStr === "0") ? String(num) : saleCountStr + String(num);
  updateSaleDisplay();
}
function clearInputSale() {
  saleCountStr = "0";
  updateSaleDisplay();
  resetSaleConfirmState();
  document.getElementById("totalPrice").innerText = "0";
}
function backspaceSale() {
  if (isSaleConfirmed) resetSaleConfirmState();
  saleCountStr = (saleCountStr.length <= 1) ? "0" : saleCountStr.slice(0, -1);
  updateSaleDisplay();
}
function resetSaleConfirmState() {
  isSaleConfirmed = false;
  document.getElementById("totalAmountRow").classList.remove("active");
  const btn = document.getElementById("btnSaleAction");
  btn.classList.remove("mode-next");
  document.getElementById("btnSaleActionText").innerText = "確定";
}
function handleSaleAction() {
  if (!isSaleConfirmed) {
    const count = Number(saleCountStr);
    if (count <= 0) { alert("枚数を入力してください"); return; }
    currentTotalBilling = count * UNIT_PRICE;
    document.getElementById("totalPrice").innerText = currentTotalBilling.toLocaleString();
    document.getElementById("totalAmountRow").classList.add("active");

    isSaleConfirmed = true;
    const btn = document.getElementById("btnSaleAction");
    btn.classList.add("mode-next");
    document.getElementById("btnSaleActionText").innerText = "次へ";
  } else {
    openCheckoutScreen();
  }
}

// ── 5. 会計・お釣り計算 ──
function openCheckoutScreen() {
  const sale = document.getElementById("screenSale");
  const checkout = document.getElementById("screenCheckout");
  sale.style.opacity = "0";
  setTimeout(() => {
    sale.classList.remove("active");
    sale.style.opacity = "";
    checkout.classList.add("active");
    document.getElementById("checkoutBillingPrice").innerText = currentTotalBilling.toLocaleString();
    clearInputPay();
    document.getElementById("checkoutKeypadTray").classList.remove("tray-collapsed");
  }, 120);
}
function backToSale() {
  document.getElementById("screenCheckout").classList.remove("active");
  document.getElementById("screenSale").classList.add("active");
}
function updatePayDisplay() {
  document.getElementById("receivedPrice").innerText = Number(payReceivedStr).toLocaleString();
}
function inputNumPay(num) {
  if (isPayConfirmed) resetPayConfirmState();
  if (payReceivedStr.length >= 7 && payReceivedStr !== "0") return;
  payReceivedStr = (payReceivedStr === "0") ? String(num) : payReceivedStr + String(num);
  updatePayDisplay();
}
function clearInputPay() {
  payReceivedStr = "0";
  updatePayDisplay();
  resetPayConfirmState();
  document.getElementById("changePrice").innerText = "0";
}
function backspacePay() {
  if (isPayConfirmed) resetPayConfirmState();
  payReceivedStr = (payReceivedStr.length <= 1) ? "0" : payReceivedStr.slice(0, -1);
  updatePayDisplay();
}
function resetPayConfirmState() {
  isPayConfirmed = false;
  document.getElementById("rowChange").classList.remove("active");
  const btn = document.getElementById("btnPayAction");
  btn.classList.remove("mode-complete");
  document.getElementById("btnPayActionText").innerText = "確定";
}
function handlePayAction() {
  if (!isPayConfirmed) {
    const received = Number(payReceivedStr);
    if (received < currentTotalBilling) { alert("受領金額が請求金額を下回っています"); return; }
    const change = received - currentTotalBilling;
    document.getElementById("changePrice").innerText = change.toLocaleString();
    document.getElementById("rowChange").classList.add("active");

    isPayConfirmed = true;
    const btn = document.getElementById("btnPayAction");
    btn.classList.add("mode-complete");
    document.getElementById("btnPayActionText").innerText = "OK";
  } else {
    completeOrder();
  }
}

// ── 6. 単一連番（1, 2, 3...）の自動採番 ──
function getNextOrderNo() {
  const allOrders = [...orderHistory, ...trashHistory];
  let maxNo = 0;
  allOrders.forEach(o => {
    const num = parseInt(o.no, 10);
    if (!isNaN(num) && num > maxNo) {
      maxNo = num;
    }
  });
  return maxNo + 1;
}

function completeOrder() {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const sheets = Number(saleCountStr);
  const received = Number(payReceivedStr);
  const change = received - (sheets * UNIT_PRICE);

  const orderItem = {
    id: "ord_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
    no: getNextOrderNo(), // 固有連番
    time: timeStr,
    sheetCount: sheets,
    received: received,
    change: change
  };

  orderHistory.push(orderItem);
  localStorage.setItem("pos_sales_data", JSON.stringify(orderHistory));

  enqueueOrSend("create", { data: orderItem });
  showSuccessModal(sheets, currentTotalBilling);
}

function showSuccessModal(sheets, total) {
  const modal = document.getElementById("completionModal");
  document.getElementById("modalSummary").innerText = `${sheets}枚  ${total.toLocaleString()}円`;
  modal.classList.add("show");

  setTimeout(() => {
    modal.classList.remove("show");
    document.getElementById("screenCheckout").classList.remove("active");
    document.getElementById("screenSale").classList.remove("active");
    document.getElementById("screenMenu").classList.add("active");
    clearInputSale();
    clearInputPay();
  }, 1600);
}

// ── 7. 集計・管理画面 ──
function openManageScreen() {
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenManage").classList.add("active");

  renderManageTable();
  if (navigator.onLine) fetchFromGAS(false);
}
function closeManageScreen() {
  document.getElementById("screenManage").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}

function switchManageTab(tab) {
  activeTab = tab;
  document.getElementById("tabActive").classList.toggle("active", tab === "active");
  document.getElementById("tabTrash").classList.toggle("active", tab === "trash");
  document.getElementById("activeActionBar").style.display = (tab === "active") ? "flex" : "none";
  renderManageTable();
}

function renderManageTable() {
  const theadRow = document.getElementById("tableHeaderRow");
  const tbody = document.getElementById("dataTableBody");
  tbody.innerHTML = "";

  let totalSheets = 0;
  let totalSales = 0;
  orderHistory.forEach(item => {
    totalSheets += item.sheetCount;
    totalSales += (item.sheetCount * UNIT_PRICE);
  });
  document.getElementById("summaryTotalSheets").innerText = totalSheets.toLocaleString();
  document.getElementById("summaryTotalSales").innerText = totalSales.toLocaleString();
  document.getElementById("summaryTotalOrders").innerText = orderHistory.length.toLocaleString();
  document.getElementById("trashCountBadge").innerText = trashHistory.length;

  if (activeTab === "active") {
    theadRow.innerHTML = `
      <th class="th-chk"><input type="checkbox" id="checkAll" onchange="toggleSelectAll(this)"></th>
      <th>No.</th>
      <th>時刻</th>
      <th>販売枚数</th>
      <th>受領金額</th>
      <th>釣り</th>
      <th>操作</th>
    `;

    orderHistory.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="td-chk"><input type="checkbox" class="row-chk" value="${item.id}" onchange="onRowCheckChange()"></td>
        <td><strong>${item.no}</strong></td>
        <td>${item.time}</td>
        <td><strong>${item.sheetCount}</strong> 枚</td>
        <td>${item.received.toLocaleString()} 円</td>
        <td>${item.change.toLocaleString()} 円</td>
        <td><button class="btn-row-edit" onclick="openEditModal('${item.id}')">編集</button></td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("checkAll").checked = false;
    onRowCheckChange();

  } else {
    theadRow.innerHTML = `
      <th>No.</th>
      <th>時刻</th>
      <th>販売枚数</th>
      <th>金額</th>
      <th>削除日時</th>
      <th>操作</th>
    `;

    if (trashHistory.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:24px;">削除されたデータはありません</td></tr>`;
      return;
    }

    trashHistory.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong style="color:#ef4444;">${item.no}</strong></td>
        <td>${item.time}</td>
        <td>${item.sheetCount} 枚</td>
        <td>${(item.sheetCount * UNIT_PRICE).toLocaleString()} 円</td>
        <td style="font-size:0.8rem; color:#64748b;">${item.deletedAt || "不明"}</td>
        <td><button class="btn-row-restore" onclick="restoreRow('${item.id}')">↩ 復元する</button></td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function toggleSelectAll(master) {
  document.querySelectorAll(".row-chk").forEach(chk => chk.checked = master.checked);
  onRowCheckChange();
}
function onRowCheckChange() {
  const selected = document.querySelectorAll(".row-chk:checked");
  const count = selected.length;
  document.getElementById("selectedCountText").innerText = count;
  document.getElementById("btnBulkDelete").disabled = (count === 0);
}

// ── 8. 一括削除 ──
function deleteSelectedRows() {
  const selectedIds = Array.from(document.querySelectorAll(".row-chk:checked")).map(el => el.value);
  if (selectedIds.length === 0) return;

  if (!confirm(`選択した ${selectedIds.length} 件を削除しますか？\n（削除データはゴミ箱へ保管され、いつでも復元できます）`)) return;

  const nowStr = new Date().toLocaleTimeString();
  const deletedItems = orderHistory.filter(item => selectedIds.includes(item.id)).map(item => ({
    ...item,
    deletedAt: nowStr
  }));

  trashHistory.push(...deletedItems);
  orderHistory = orderHistory.filter(item => !selectedIds.includes(item.id));

  localStorage.setItem("pos_sales_data", JSON.stringify(orderHistory));
  localStorage.setItem("pos_trash_data", JSON.stringify(trashHistory));

  enqueueOrSend("delete", { ids: selectedIds });
  renderManageTable();
}

// ── 9. 復元（差し戻し ＆ スプシ同期保証） ──
async function restoreRow(id) {
  const itemIndex = trashHistory.findIndex(item => item.id === id);
  if (itemIndex === -1) return;

  const item = trashHistory[itemIndex];
  trashHistory.splice(itemIndex, 1);

  // 数値順（No.1, No.2, No.3...）で綺麗に差し戻す
  orderHistory.push(item);
  orderHistory.sort((a, b) => Number(a.no) - Number(b.no));

  localStorage.setItem("pos_sales_data", JSON.stringify(orderHistory));
  localStorage.setItem("pos_trash_data", JSON.stringify(trashHistory));

  renderManageTable();

  // スプシへ復元リクエストを送り、確実に完了を待つ
  if (!navigator.onLine) {
    enqueueOrSend("restore", { id: id });
  } else {
    try {
      await sendPostToGAS("restore", { id: id });
      console.log("スプシ側で復元＆ソート完了");
    } catch (err) {
      console.warn("復元送信失敗、キューに保持:", err);
      enqueueOrSend("restore", { id: id });
    }
  }

  alert(`No.${item.no} のデータを元の位置に復元しました！`);
}

// ── 10. 編集モーダル ──
function openEditModal(id) {
  const item = orderHistory.find(o => o.id === id);
  if (!item) return;

  editingOrderId = id;
  document.getElementById("editNoText").innerText = item.no;
  document.getElementById("editSheets").value = item.sheetCount;
  document.getElementById("editReceived").value = item.received;
  recalcEdit();
  document.getElementById("editModal").classList.add("show");
}
function closeEditModal() {
  document.getElementById("editModal").classList.remove("show");
  editingOrderId = null;
}
function recalcEdit() {
  const sheets = Number(document.getElementById("editSheets").value || 0);
  const received = Number(document.getElementById("editReceived").value || 0);
  const change = received - (sheets * UNIT_PRICE);
  document.getElementById("editChange").innerText = `${change.toLocaleString()} 円`;
}
function saveEditRow() {
  const sheets = Number(document.getElementById("editSheets").value);
  const received = Number(document.getElementById("editReceived").value);
  if (sheets <= 0) { alert("枚数は1枚以上にしてください"); return; }
  if (received < (sheets * UNIT_PRICE)) { alert("受領金額が不足しています"); return; }

  const index = orderHistory.findIndex(o => o.id === editingOrderId);
  if (index !== -1) {
    orderHistory[index].sheetCount = sheets;
    orderHistory[index].received = received;
    orderHistory[index].change = received - (sheets * UNIT_PRICE);

    localStorage.setItem("pos_sales_data", JSON.stringify(orderHistory));
    enqueueOrSend("update", { data: orderHistory[index] });
    renderManageTable();
    closeEditModal();
  }
}

// ── 11. オフラインキュー ＆ 通信処理 ──
function enqueueOrSend(action, payload) {
  if (!navigator.onLine) {
    offlineQueue.push({ id: "q_" + Date.now() + "_" + Math.random(), action, payload });
    localStorage.setItem("pos_offline_queue", JSON.stringify(offlineQueue));
    updateOnlineStatus();
  } else {
    sendPostToGAS(action, payload).catch(err => {
      offlineQueue.push({ id: "q_" + Date.now() + "_" + Math.random(), action, payload });
      localStorage.setItem("pos_offline_queue", JSON.stringify(offlineQueue));
      updateOnlineStatus();
    });
  }
}

async function sendPostToGAS(action, payload) {
  if (!GAS_URL || GAS_URL.includes("YOUR_GAS_WEB_APP_URL_HERE")) return;
  const formData = new FormData();
  formData.append("data", JSON.stringify({ action: action, ...payload }));
  await fetch(GAS_URL, { method: "POST", mode: "no-cors", body: formData });
}

function fetchFromGAS(isManual) {
  if (!GAS_URL || GAS_URL.includes("YOUR_GAS_WEB_APP_URL_HERE")) return;
  if (!navigator.onLine) {
    if (isManual) alert("オフラインのためスプレッドシートから読み込めません。");
    return;
  }

  // オフライン未送信キューがあれば、まずそれを先に全て送信
  if (offlineQueue.length > 0) {
    flushOfflineQueue().then(() => fetchFromGAS(isManual));
    return;
  }

  const syncBtn = document.getElementById("btnSync");
  if (syncBtn) { syncBtn.classList.add("syncing"); syncBtn.innerText = "同期中..."; }

  const callbackName = "gasCallback_" + Math.floor(Math.random() * 1000000);
  const script = document.createElement("script");
  script.src = `${GAS_URL}?callback=${callbackName}&_=${Date.now()}`;

  window[callbackName] = function(json) {
    if (json && json.status === "success") {
      if (Array.isArray(json.list)) {
        orderHistory = json.list;
        localStorage.setItem("pos_sales_data", JSON.stringify(orderHistory));
      }
      if (Array.isArray(json.trashList)) {
        trashHistory = json.trashList;
        localStorage.setItem("pos_trash_data", JSON.stringify(trashHistory));
      }
      renderManageTable();
      console.log("スプシ同期完了（履歴・ゴミ箱）");
    }
    cleanup();
  };

  script.onerror = function() {
    console.warn("スプシ同期エラー（キャッシュ使用）");
    cleanup();
  };

  function cleanup() {
    delete window[callbackName];
    if (script.parentNode) script.parentNode.removeChild(script);
    if (syncBtn) { syncBtn.classList.remove("syncing"); syncBtn.innerText = "スプシ再読込"; }
  }

  document.body.appendChild(script);
}

function onNavigate(screen) {
  console.log("Navigate to:", screen);
}

if (navigator.onLine) fetchFromGAS(false);