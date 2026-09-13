// ★★★ Google Apps Script ウェブアプリURL ★★★
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzvkpbYbCp_2grTdcpxu8m5IOXrTGLSFhdJTXP8Z3BXKHWBNDMMBh2rcUx6VQHHX4Nq5g/exec";
let GAS_URL = localStorage.getItem("pos_gas_url") || DEFAULT_GAS_URL;

// 管理者パスキー
const ADMIN_PASSKEY = "1207";

// 金券単価（設定可能）
let UNIT_PRICE = Number(localStorage.getItem("pos_unit_price") || 500);

// 音声設定（デフォルトON）
let isSoundEnabled = localStorage.getItem("pos_sound_enabled") !== "false";

// 開催日設定（デフォルト: 1日目）
let currentDay = localStorage.getItem("pos_current_day") || "1";

// 販売・会計の状態管理
let saleCountStr = "0";
let isSaleConfirmed = false;
let payReceivedStr = "0";
let currentTotalBilling = 0;
let isPayConfirmed = false;

// 返金の状態管理
let refundCountStr = "0";
let isRefundConfirmed = false;

// データ配列（販売 / 返金 / 削除履歴 / オフライン未送信キュー）
let orderHistory = JSON.parse(localStorage.getItem(`pos_sales_data_${currentDay}`) || "[]");
let refundHistory = JSON.parse(localStorage.getItem(`pos_refund_data_${currentDay}`) || "[]");
let trashHistory = JSON.parse(localStorage.getItem(`pos_trash_data_${currentDay}`) || "[]");
let offlineQueue = JSON.parse(localStorage.getItem("pos_offline_queue") || "[]");

// 管理画面タブ状態
let currentMainTab = "summary"; // "summary" | "sale" | "refund"
let saleSubTab = "active";      // "active" | "trash"
let editingOrderId = null;

// パスキー入力状態
let passkeyEntered = "";
let passkeySuccessCallback = null;

// ── 音声リソース ──
const sounds = {
  tap: new Audio("audio/tap.mp3"),
  complete: new Audio("audio/complete.mp3"),
  refund: new Audio("audio/refund.mp3"),
  error: new Audio("audio/error.mp3")
};

function playSound(name) {
  if (!isSoundEnabled) return;
  if (sounds[name]) {
    sounds[name].currentTime = 0;
    sounds[name].play().catch(e => console.warn("音声再生制限:", e));
  }
}

function toggleSound() {
  isSoundEnabled = !isSoundEnabled;
  localStorage.setItem("pos_sound_enabled", isSoundEnabled);
  updateSoundUI();
}

function updateSoundUI() {
  const btn = document.getElementById("btnSoundToggle");
  const icon = document.getElementById("soundIcon");
  const text = document.getElementById("soundText");
  if (!btn) return;

  if (isSoundEnabled) {
    btn.classList.remove("muted");
    icon.innerText = "🔊";
    text.innerText = "音声 ON";
  } else {
    btn.classList.add("muted");
    icon.innerText = "🔇";
    text.innerText = "音声 OFF";
  }
}

function updateDayUI() {
  const dayText = `${currentDay}日目`;
  document.querySelectorAll(".day-badge").forEach(el => {
    el.innerText = dayText;
  });
}

// ── 1. オンライン / オフライン監視 ＆ キュー自動同期 ──
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
setupSwipeDown("refundKeypadTray");

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
  playSound("tap");
  if (isSaleConfirmed) resetSaleConfirmState();
  if (saleCountStr.length >= 3 && saleCountStr !== "0") return;
  saleCountStr = (saleCountStr === "0") ? String(num) : saleCountStr + String(num);
  updateSaleDisplay();
}
function clearInputSale() {
  playSound("tap");
  saleCountStr = "0";
  updateSaleDisplay();
  resetSaleConfirmState();
  document.getElementById("totalPrice").innerText = "0";
}
function backspaceSale() {
  playSound("tap");
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
  playSound("tap");
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
  playSound("tap");
  if (isPayConfirmed) resetPayConfirmState();
  if (payReceivedStr.length >= 7 && payReceivedStr !== "0") return;
  payReceivedStr = (payReceivedStr === "0") ? String(num) : payReceivedStr + String(num);
  updatePayDisplay();
}
function clearInputPay() {
  playSound("tap");
  payReceivedStr = "0";
  updatePayDisplay();
  resetPayConfirmState();
  document.getElementById("changePrice").innerText = "0";
}
function backspacePay() {
  playSound("tap");
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
    playSound("tap");
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

// ── 6. 販売確定・保存 ──
function getNextOrderNo() {
  const allOrders = [...orderHistory, ...trashHistory];
  let maxNo = 0;
  allOrders.forEach(o => {
    const num = parseInt(o.no, 10);
    if (!isNaN(num) && num > maxNo) maxNo = num;
  });
  return maxNo + 1;
}

function completeOrder() {
  playSound("complete");
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const sheets = Number(saleCountStr);
  const received = Number(payReceivedStr);
  const change = received - (sheets * UNIT_PRICE);

  const orderItem = {
    id: "ord_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
    no: getNextOrderNo(),
    time: timeStr,
    sheetCount: sheets,
    received: received,
    change: change,
    day: currentDay
  };

  orderHistory.push(orderItem);
  saveCurrentDayStorage();

  enqueueOrSend("create", { data: orderItem });
  showSuccessModal("販売完了", `${sheets}枚  ${currentTotalBilling.toLocaleString()}円`, false);
}

// ── 7. 返金処理画面ロジック ──
function openRefundScreen() {
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenRefund").classList.add("active");
  clearInputRefund();
  document.getElementById("refundKeypadTray").classList.remove("tray-collapsed");
}
function closeRefundScreen() {
  document.getElementById("screenRefund").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}
function updateRefundDisplay() {
  document.getElementById("refundSheetCount").innerText = Number(refundCountStr).toLocaleString();
}
function inputNumRefund(num) {
  playSound("tap");
  if (isRefundConfirmed) resetRefundConfirmState();
  if (refundCountStr.length >= 3 && refundCountStr !== "0") return;
  refundCountStr = (refundCountStr === "0") ? String(num) : refundCountStr + String(num);
  updateRefundDisplay();
}
function clearInputRefund() {
  playSound("tap");
  refundCountStr = "0";
  updateRefundDisplay();
  resetRefundConfirmState();
  document.getElementById("refundTotalPrice").innerText = "0";
}
function backspaceRefund() {
  playSound("tap");
  if (isRefundConfirmed) resetRefundConfirmState();
  refundCountStr = (refundCountStr.length <= 1) ? "0" : refundCountStr.slice(0, -1);
  updateRefundDisplay();
}
function resetRefundConfirmState() {
  isRefundConfirmed = false;
  document.getElementById("refundAmountRow").classList.remove("active");
  const btn = document.getElementById("btnRefundAction");
  btn.classList.remove("mode-refund-confirm");
  document.getElementById("btnRefundActionText").innerText = "確定";
}
function handleRefundAction() {
  playSound("tap");
  if (!isRefundConfirmed) {
    const count = Number(refundCountStr);
    if (count <= 0) { alert("返金枚数を入力してください"); return; }
    const totalRefund = count * UNIT_PRICE;
    document.getElementById("refundTotalPrice").innerText = `-${totalRefund.toLocaleString()}`;
    document.getElementById("refundAmountRow").classList.add("active");

    isRefundConfirmed = true;
    const btn = document.getElementById("btnRefundAction");
    btn.classList.add("mode-refund-confirm");
    document.getElementById("btnRefundActionText").innerText = "返金を確定";
  } else {
    completeRefund();
  }
}

function getNextRefundNo() {
  let maxNo = 0;
  refundHistory.forEach(r => {
    const num = parseInt(r.no, 10);
    if (!isNaN(num) && num > maxNo) maxNo = num;
  });
  return maxNo + 1;
}

function completeRefund() {
  playSound("refund");
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const sheets = Number(refundCountStr);
  const refundAmount = sheets * UNIT_PRICE;

  const refundItem = {
    id: "ref_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
    no: getNextRefundNo(),
    time: timeStr,
    sheetCount: sheets,
    amount: refundAmount,
    day: currentDay
  };

  refundHistory.push(refundItem);
  saveCurrentDayStorage();

  enqueueOrSend("create_refund", { data: refundItem });
  showSuccessModal("返金完了", `${sheets}枚  -${refundAmount.toLocaleString()}円`, true);
}

// ── 8. 完了モーダル表示 ──
function showSuccessModal(title, subtitle, isRefund) {
  const modal = document.getElementById("completionModal");
  const card = document.getElementById("successCard");
  document.getElementById("modalTitle").innerText = title;
  document.getElementById("modalSummary").innerText = subtitle;

  if (isRefund) {
    card.classList.add("refund-card-theme");
  } else {
    card.classList.remove("refund-card-theme");
  }

  modal.classList.add("show");

  setTimeout(() => {
    modal.classList.remove("show");
    document.getElementById("screenCheckout").classList.remove("active");
    document.getElementById("screenSale").classList.remove("active");
    document.getElementById("screenRefund").classList.remove("active");
    document.getElementById("screenMenu").classList.add("active");
    clearInputSale();
    clearInputPay();
    clearInputRefund();
  }, 1600);
}

// ── 9. 集計・管理画面（3タブ制御） ──
function openManageScreen() {
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenManage").classList.add("active");

  renderAllManageViews();
  if (navigator.onLine) fetchFromGAS(false);
}
function closeManageScreen() {
  document.getElementById("screenManage").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}

function switchMainTab(tab) {
  currentMainTab = tab;
  document.getElementById("tabNavSummary").classList.toggle("active", tab === "summary");
  document.getElementById("tabNavSale").classList.toggle("active", tab === "sale");
  document.getElementById("tabNavRefund").classList.toggle("active", tab === "refund");

  document.getElementById("tabContentSummary").classList.toggle("active", tab === "summary");
  document.getElementById("tabContentSale").classList.toggle("active", tab === "sale");
  document.getElementById("tabContentRefund").classList.toggle("active", tab === "refund");

  renderAllManageViews();
}

function switchSaleSubTab(sub) {
  saleSubTab = sub;
  document.getElementById("subTabActive").classList.toggle("active", sub === "active");
  document.getElementById("subTabTrash").classList.toggle("active", sub === "trash");
  document.getElementById("activeActionBar").style.display = (sub === "active") ? "flex" : "none";
  renderSaleTable();
}

function renderAllManageViews() {
  // 1. サマリー計算
  let totalSaleSheets = 0;
  let totalSaleAmount = 0;
  orderHistory.forEach(item => {
    totalSaleSheets += item.sheetCount;
    totalSaleAmount += (item.sheetCount * UNIT_PRICE);
  });

  let totalRefundSheets = 0;
  let totalRefundAmount = 0;
  refundHistory.forEach(item => {
    totalRefundSheets += item.sheetCount;
    totalRefundAmount += item.amount;
  });

  const netSales = totalSaleAmount - totalRefundAmount;

  document.getElementById("sumNetSales").innerText = netSales.toLocaleString();
  document.getElementById("sumSaleSheets").innerText = totalSaleSheets.toLocaleString();
  document.getElementById("sumSaleAmount").innerText = totalSaleAmount.toLocaleString();
  document.getElementById("sumSaleOrders").innerText = orderHistory.length.toLocaleString();

  document.getElementById("sumRefundSheets").innerText = totalRefundSheets.toLocaleString();
  document.getElementById("sumRefundAmount").innerText = totalRefundAmount.toLocaleString();
  document.getElementById("sumRefundOrders").innerText = refundHistory.length.toLocaleString();

  document.getElementById("trashCountBadge").innerText = trashHistory.length;
  document.getElementById("refundTotalCountText").innerText = refundHistory.length.toLocaleString();

  // 2. テーブル描画
  renderSaleTable();
  renderRefundTable();
}

function renderSaleTable() {
  const theadRow = document.getElementById("tableHeaderRow");
  const tbody = document.getElementById("dataTableBody");
  tbody.innerHTML = "";

  if (saleSubTab === "active") {
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

function renderRefundTable() {
  const tbody = document.getElementById("refundTableBody");
  tbody.innerHTML = "";

  if (refundHistory.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:24px;">返金データはありません</td></tr>`;
    return;
  }

  refundHistory.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong style="color:#dc2626;">R-${item.no}</strong></td>
      <td>${item.time}</td>
      <td><strong>${item.sheetCount}</strong> 枚</td>
      <td style="color:#dc2626; font-weight:bold;">-${item.amount.toLocaleString()} 円</td>
      <td><button class="btn-row-delete-refund" onclick="deleteRefundRow('${item.id}')">削除</button></td>
    `;
    tbody.appendChild(tr);
  });
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

// ── 10. 販売データ削除・復元 ──
async function deleteSelectedRows() {
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

  saveCurrentDayStorage();
  renderAllManageViews();

  if (navigator.onLine) {
    try {
      await sendPostToGAS("delete", { ids: selectedIds });
      fetchFromGAS(false);
    } catch (e) {
      enqueueOrSend("delete", { ids: selectedIds });
    }
  } else {
    enqueueOrSend("delete", { ids: selectedIds });
  }
}

async function restoreRow(id) {
  const itemIndex = trashHistory.findIndex(item => item.id === id);
  if (itemIndex === -1) return;

  const item = trashHistory[itemIndex];
  trashHistory.splice(itemIndex, 1);

  orderHistory.push(item);
  orderHistory.sort((a, b) => Number(a.no) - Number(b.no));

  saveCurrentDayStorage();
  renderAllManageViews();

  if (!navigator.onLine) {
    enqueueOrSend("restore", { id: id });
  } else {
    try {
      await sendPostToGAS("restore", { id: id });
      fetchFromGAS(false);
    } catch (err) {
      enqueueOrSend("restore", { id: id });
    }
  }

  alert(`No.${item.no} のデータを元の位置に復元しました！`);
}

// 返金データの削除
async function deleteRefundRow(id) {
  if (!confirm("この返金記録を削除しますか？\n（スプレッドシートからも行が削除されます）")) return;

  refundHistory = refundHistory.filter(r => r.id !== id);
  saveCurrentDayStorage();
  renderAllManageViews();

  if (navigator.onLine) {
    try {
      await sendPostToGAS("delete_refund", { ids: [id] });
      fetchFromGAS(false);
    } catch (e) {
      enqueueOrSend("delete_refund", { ids: [id] });
    }
  } else {
    enqueueOrSend("delete_refund", { ids: [id] });
  }
}

// ── 11. 販売編集モーダル ──
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
async function saveEditRow() {
  const sheets = Number(document.getElementById("editSheets").value);
  const received = Number(document.getElementById("editReceived").value);
  if (sheets <= 0) { alert("枚数は1枚以上にしてください"); return; }
  if (received < (sheets * UNIT_PRICE)) { alert("受領金額が不足しています"); return; }

  const index = orderHistory.findIndex(o => o.id === editingOrderId);
  if (index !== -1) {
    orderHistory[index].sheetCount = sheets;
    orderHistory[index].received = received;
    orderHistory[index].change = received - (sheets * UNIT_PRICE);

    saveCurrentDayStorage();

    if (navigator.onLine) {
      try {
        await sendPostToGAS("update", { data: orderHistory[index] });
        fetchFromGAS(false);
      } catch (e) {
        enqueueOrSend("update", { data: orderHistory[index] });
      }
    } else {
      enqueueOrSend("update", { data: orderHistory[index] });
    }

    renderAllManageViews();
    closeEditModal();
  }
}

// ── 12. レジ設定画面 ──
function openSettingsScreen() {
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenSettings").classList.add("active");

  document.getElementById("settingUnitPrice").value = UNIT_PRICE;
  document.getElementById("settingGasUrl").value = GAS_URL;
  updateSettingsDayButtons();
}
function closeSettingsScreen() {
  document.getElementById("screenSettings").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}
function updateSettingsDayButtons() {
  document.getElementById("btnDay1").classList.toggle("active", currentDay === "1");
  document.getElementById("btnDay2").classList.toggle("active", currentDay === "2");
}

function setDay(day) {
  if (currentDay === day) return;
  currentDay = day;
  localStorage.setItem("pos_current_day", currentDay);

  orderHistory = JSON.parse(localStorage.getItem(`pos_sales_data_${currentDay}`) || "[]");
  refundHistory = JSON.parse(localStorage.getItem(`pos_refund_data_${currentDay}`) || "[]");
  trashHistory = JSON.parse(localStorage.getItem(`pos_trash_data_${currentDay}`) || "[]");

  updateDayUI();
  updateSettingsDayButtons();

  if (navigator.onLine) fetchFromGAS(false);

  alert(`「${currentDay}日目」に切り替えました。\n（スプシ参照先: 販売データ${currentDay} / 返金データ${currentDay}）`);
}

function saveUnitPriceSetting() {
  const val = Number(document.getElementById("settingUnitPrice").value);
  if (val <= 0) { alert("有効な価格を入力してください"); return; }
  UNIT_PRICE = val;
  localStorage.setItem("pos_unit_price", UNIT_PRICE);
  alert(`金券単価を「${UNIT_PRICE.toLocaleString()}円」に更新しました！`);
}

function saveGasUrlSetting() {
  const url = document.getElementById("settingGasUrl").value.trim();
  if (!url.startsWith("https://script.google.com/")) {
    alert("正しいGoogle Apps ScriptのURLを入力してください。");
    return;
  }
  GAS_URL = url;
  localStorage.setItem("pos_gas_url", GAS_URL);
  alert("スプレッドシート連携URLを更新しました！");
  if (navigator.onLine) fetchFromGAS(false);
}

// ── 13. パスキー認証テンキーモーダル ──
function openPasskeyModal(promptText, callback) {
  passkeyEntered = "";
  passkeySuccessCallback = callback;
  document.getElementById("passkeyInput").value = "";
  document.getElementById("passkeyErrorMsg").innerText = "";
  document.getElementById("passkeyPromptText").innerText = promptText;
  document.getElementById("passkeyModal").classList.add("show");
}

function closePasskeyModal() {
  document.getElementById("passkeyModal").classList.remove("show");
  passkeyEntered = "";
}

function inputPasskey(num) {
  playSound("tap");
  if (passkeyEntered.length >= 4) return;
  passkeyEntered += num;
  document.getElementById("passkeyInput").value = passkeyEntered;

  if (passkeyEntered.length === 4) {
    if (passkeyEntered === ADMIN_PASSKEY) {
      const cb = passkeySuccessCallback;
      closePasskeyModal();
      if (cb) {
        // モーダルが閉じた後にコールバックを確実に実行
        setTimeout(cb, 250);
      }
    } else {
      document.getElementById("passkeyErrorMsg").innerText = "パスキーが正しくありません";
      playSound("error");
      setTimeout(clearPasskey, 500);
    }
  }
}

function clearPasskey() {
  passkeyEntered = "";
  document.getElementById("passkeyInput").value = "";
  document.getElementById("passkeyErrorMsg").innerText = "";
}

function backspacePasskey() {
  playSound("tap");
  passkeyEntered = passkeyEntered.slice(0, -1);
  document.getElementById("passkeyInput").value = passkeyEntered;
  document.getElementById("passkeyErrorMsg").innerText = "";
}

// ── 初期化リクエスト（修正版：確実に動作） ──
function requestResetWithPasskey() {
  openPasskeyModal("初期化を実行するには管理者パスキーを入力してください", () => {
    if (confirm("【警告】端末内のデータを全て消去します。\n（本番開始前のテストデータ消去用）\n本当によろしいですか？")) {
      executeResetAllData();
    }
  });
}

function executeResetAllData() {
  orderHistory = [];
  refundHistory = [];
  trashHistory = [];
  offlineQueue = [];

  localStorage.removeItem("pos_sales_data_1");
  localStorage.removeItem("pos_sales_data_2");
  localStorage.removeItem("pos_refund_data_1");
  localStorage.removeItem("pos_refund_data_2");
  localStorage.removeItem("pos_trash_data_1");
  localStorage.removeItem("pos_trash_data_2");
  localStorage.removeItem("pos_offline_queue");

  saveCurrentDayStorage();
  renderAllManageViews();
  updateOnlineStatus();

  alert("端末データを完全にリセットしました！");
}

function saveCurrentDayStorage() {
  localStorage.setItem(`pos_sales_data_${currentDay}`, JSON.stringify(orderHistory));
  localStorage.setItem(`pos_refund_data_${currentDay}`, JSON.stringify(refundHistory));
  localStorage.setItem(`pos_trash_data_${currentDay}`, JSON.stringify(trashHistory));
}

// ── 14. オフラインキュー ＆ 通信処理 ──
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
  formData.append("data", JSON.stringify({ action: action, day: currentDay, ...payload }));
  await fetch(GAS_URL, { method: "POST", mode: "no-cors", body: formData });
}

function fetchFromGAS(isManual) {
  if (!GAS_URL || GAS_URL.includes("YOUR_GAS_WEB_APP_URL_HERE")) return;
  if (!navigator.onLine) {
    if (isManual) alert("オフラインのためスプレッドシートから読み込めません。");
    return;
  }

  if (offlineQueue.length > 0) {
    flushOfflineQueue().then(() => fetchFromGAS(isManual));
    return;
  }

  const syncBtn = document.getElementById("btnSync");
  if (syncBtn) { syncBtn.classList.add("syncing"); syncBtn.innerText = "同期中..."; }

  const callbackName = "gasCallback_" + Math.floor(Math.random() * 1000000);
  const script = document.createElement("script");
  script.src = `${GAS_URL}?callback=${callbackName}&day=${currentDay}&_=${Date.now()}`;

  window[callbackName] = function(json) {
    if (json && json.status === "success") {
      if (Array.isArray(json.list)) {
        orderHistory = json.list;
      }
      if (Array.isArray(json.refundList)) {
        refundHistory = json.refundList;
      }
      if (Array.isArray(json.trashList)) {
        trashHistory = json.trashList;
      }
      saveCurrentDayStorage();
      renderAllManageViews();
      console.log(`スプシ同期完了（${currentDay}日目: 販売・返金・ゴミ箱）`);
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

// 起動時のUI初期化
updateSoundUI();
updateDayUI();
if (navigator.onLine) fetchFromGAS(false);