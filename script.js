// ★★★ Google Apps Script ウェブアプリURL ★★★
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzvkpbYbCp_2grTdcpxu8m5IOXrTGLSFhdJTXP8Z3BXKHWBNDMMBh2rcUx6VQHHX4Nq5g/exec";
let GAS_URL = localStorage.getItem("pos_gas_url") || DEFAULT_GAS_URL;

// 管理者パスキー
const ADMIN_PASSKEY = "1207";

// アプリの起動ロック状態（リロードするまで解除維持）
let isAppUnlocked = false;
let bootPasskeyEntered = "";

// 金券単価設定（セット販売用 ＆ バラ返金用）
let UNIT_PRICE = Number(localStorage.getItem("pos_unit_price") || 500);
let REFUND_UNIT_PRICE = Number(localStorage.getItem("pos_refund_unit_price") || 50);

// 本番モード（デフォルト: false = テスト中）
let isProdMode = localStorage.getItem("pos_is_prod_mode") === "true";

// 音声設定（デフォルトON）
let isSoundEnabled = localStorage.getItem("pos_sound_enabled") !== "false";

// 開催日設定（デフォルト: 1日目）
let currentDay = localStorage.getItem("pos_current_day") || "1";
let selectedSettingDay = currentDay;

// 販売・会計の状態管理
let saleCountStr = "0";
let isSaleConfirmed = false;
let payReceivedStr = "0";
let currentTotalBilling = 0;
let isPayConfirmed = false;

// 返金の状態管理
let refundCountStr = "0";
let isRefundConfirmed = false;

// データ配列
let orderHistory = JSON.parse(localStorage.getItem(`pos_sales_data_${currentDay}`) || "[]");
let refundHistory = JSON.parse(localStorage.getItem(`pos_refund_data_${currentDay}`) || "[]");
let trashHistory = JSON.parse(localStorage.getItem(`pos_trash_data_${currentDay}`) || "[]");
let offlineQueue = JSON.parse(localStorage.getItem("pos_offline_queue") || "[]");

// 管理画面タブ状態
let currentMainTab = "summary";
let saleSubTab = "active";
let editingOrderId = null;

// 管理者用パスキー入力状態
let passkeyEntered = "";
let passkeySuccessCallback = null;

// ── 時刻フォーマット整形関数（1899年バグ完全解消） ──
function cleanTimeStr(str) {
  if (!str) return "--:--:--";
  const s = String(str);
  const match = s.match(/\d{2}:\d{2}:\d{2}/);
  if (match) {
    return match[0];
  }
  return s;
}

// ── Web Audio API による極上・多彩UI効果音エンジン ──
let audioCtx = null;

function soundEffect(type) {
  if (!isSoundEnabled) return;

  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }

    if (!audioCtx) return;

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    // 1. テンキー入力（高級マリンバ・硬質ウッドブロック調）
    if (type === 'tap') {
      const randomPitchOffset = (Math.random() * 60) - 30;
      const baseFreq = 860 + randomPitchOffset;

      const attackBuf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.008), audioCtx.sampleRate);
      const data = attackBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.3));
      }
      const attackSource = audioCtx.createBufferSource();
      attackSource.buffer = attackBuf;

      const attackFilter = audioCtx.createBiquadFilter();
      attackFilter.type = 'bandpass';
      attackFilter.frequency.setValueAtTime(3200, now);
      attackFilter.Q.setValueAtTime(4.0, now);

      const attackGain = audioCtx.createGain();
      attackGain.gain.setValueAtTime(0.4, now);
      attackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.008);

      attackSource.connect(attackFilter);
      attackFilter.connect(attackGain);
      attackGain.connect(audioCtx.destination);
      attackSource.start(now);

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.35, now + 0.038);

      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.038);

    // 2. バックスペース（BS）
    } else if (type === 'backspace') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.025);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.05);

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.05);

    // 3. クリア（C）
    } else if (type === 'clear') {
      const carrier = audioCtx.createOscillator();
      const modulator = audioCtx.createOscillator();
      const modGain = audioCtx.createGain();
      const mainGain = audioCtx.createGain();

      carrier.type = 'sine';
      modulator.type = 'sine';

      carrier.frequency.setValueAtTime(900, now);
      carrier.frequency.exponentialRampToValueAtTime(220, now + 0.09);

      modulator.frequency.setValueAtTime(300, now);
      modulator.frequency.exponentialRampToValueAtTime(80, now + 0.09);

      modGain.gain.setValueAtTime(400, now);
      modGain.gain.exponentialRampToValueAtTime(1, now + 0.09);

      mainGain.gain.setValueAtTime(0.25, now);
      mainGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(mainGain);
      mainGain.connect(audioCtx.destination);

      modulator.start(now);
      carrier.start(now);
      modulator.stop(now + 0.09);
      carrier.stop(now + 0.09);

    // 4. 確定 / 次へ（ピピッ音）
    } else if (type === 'confirm') {
      [0, 0.06].forEach((delay, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(i === 0 ? 587.33 : 880, now + delay);
        gain.gain.setValueAtTime(0.3, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.08);
      });

    // 5. 会計完了（ポロロ〜ン和音チャイム）
    } else if (type === 'success') {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const delay = i * 0.07;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + delay);
        gain.gain.setValueAtTime(0.25, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.45);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.45);
      });

    // 6. 返金完了（温かみのあるベル音）
    } else if (type === 'refund') {
      const notes = [783.99, 587.33];
      notes.forEach((freq, i) => {
        const delay = i * 0.09;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + delay);
        gain.gain.setValueAtTime(0.28, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.38);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.38);
      });

    // 7. エラー・警告音
    } else if (type === 'error') {
      [0, 0.08].forEach((delay) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, now + delay);
        osc.frequency.exponentialRampToValueAtTime(70, now + delay + 0.07);
        gain.gain.setValueAtTime(0.35, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.07);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.07);
      });
    }
  } catch (err) {
    console.warn("Audio error:", err);
  }
}

// ── 0. 初回アクセス起動ロック認証 ──
function inputBootPasskey(num) {
  soundEffect('tap');
  if (bootPasskeyEntered.length >= 4) return;
  bootPasskeyEntered += num;
  document.getElementById("bootPasskeyInput").value = bootPasskeyEntered;

  if (bootPasskeyEntered.length === 4) {
    if (bootPasskeyEntered === ADMIN_PASSKEY) {
      soundEffect('confirm');
      document.getElementById("bootPasskeyError").innerText = "";
      setTimeout(() => {
        isAppUnlocked = true;
        document.getElementById("appLockScreen").classList.add("unlocked");
        // ロック解除後に初回同期を開始
        if (navigator.onLine) fetchFromGAS(false);
      }, 200);
    } else {
      soundEffect('error');
      document.getElementById("bootPasskeyError").innerText = "認証に失敗しました";
      setTimeout(clearBootPasskey, 500);
    }
  }
}

function clearBootPasskey() {
  soundEffect('clear');
  bootPasskeyEntered = "";
  document.getElementById("bootPasskeyInput").value = "";
  document.getElementById("bootPasskeyError").innerText = "";
}

function backspaceBootPasskey() {
  soundEffect('backspace');
  bootPasskeyEntered = bootPasskeyEntered.slice(0, -1);
  document.getElementById("bootPasskeyInput").value = bootPasskeyEntered;
  document.getElementById("bootPasskeyError").innerText = "";
}

// ── 音声トグル切り替え ──
function toggleSound() {
  isSoundEnabled = !isSoundEnabled;
  localStorage.setItem("pos_sound_enabled", isSoundEnabled);
  updateSoundUI();
  if (isSoundEnabled) soundEffect('tap');
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
  const guide = document.getElementById("refundRateGuide");
  if (guide) guide.innerText = `バラ (${REFUND_UNIT_PRICE}円 / 枚)`;
}

function updateProdModeUI() {
  const badge = document.getElementById("prodModeBadgeMenu");
  const btn = document.getElementById("btnToggleProdMode");
  const text = document.getElementById("prodModeStatusText");

  if (isProdMode) {
    badge.classList.remove("test-mode");
    badge.innerText = "本番稼働中";
    if (btn) btn.classList.remove("test");
    if (text) text.innerText = "ON (本番モード)";
  } else {
    badge.classList.add("test-mode");
    badge.innerText = "テスト中";
    if (btn) btn.classList.add("test");
    if (text) text.innerText = "OFF (テスト中)";
  }
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
  soundEffect('tap');
  document.getElementById(trayId).classList.toggle("tray-collapsed");
}
function collapseTray(trayId) {
  const tray = document.getElementById(trayId);
  if (!tray.classList.contains("tray-collapsed")) {
    soundEffect('tap');
    tray.classList.add("tray-collapsed");
  }
}
function setupSwipeDown(trayId) {
  const tray = document.getElementById(trayId);
  let startY = 0;
  tray.addEventListener("touchstart", e => { startY = e.touches[0].clientY; }, { passive: true });
  tray.addEventListener("touchend", e => {
    if (e.changedTouches[0].clientY - startY > 40) {
      soundEffect('tap');
      tray.classList.add("tray-collapsed");
    }
  }, { passive: true });
}
setupSwipeDown("saleKeypadTray");
setupSwipeDown("checkoutKeypadTray");
setupSwipeDown("refundKeypadTray");

// ── 4. 金券販売（枚数入力） ──
function openSaleScreen() {
  soundEffect('tap');
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenSale").classList.add("active");
  clearInputSale();
  document.getElementById("saleKeypadTray").classList.remove("tray-collapsed");
}
function closeSaleScreen() {
  soundEffect('tap');
  document.getElementById("screenSale").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}
function updateSaleDisplay() {
  document.getElementById("sheetCount").innerText = Number(saleCountStr).toLocaleString();
}
function inputNumSale(num) {
  soundEffect('tap');
  if (isSaleConfirmed) resetSaleConfirmState();
  if (saleCountStr.length >= 3 && saleCountStr !== "0") return;
  saleCountStr = (saleCountStr === "0") ? String(num) : saleCountStr + String(num);
  updateSaleDisplay();
}
function clearInputSale() {
  soundEffect('clear');
  saleCountStr = "0";
  updateSaleDisplay();
  resetSaleConfirmState();
  document.getElementById("totalPrice").innerText = "0";
}
function backspaceSale() {
  soundEffect('backspace');
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
    if (count <= 0) {
      soundEffect('error');
      alert("セット数を入力してください");
      return;
    }
    soundEffect('confirm');
    currentTotalBilling = count * UNIT_PRICE;
    document.getElementById("totalPrice").innerText = currentTotalBilling.toLocaleString();
    document.getElementById("totalAmountRow").classList.add("active");

    isSaleConfirmed = true;
    const btn = document.getElementById("btnSaleAction");
    btn.classList.add("mode-next");
    document.getElementById("btnSaleActionText").innerText = "次へ";
  } else {
    soundEffect('tap');
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
  soundEffect('tap');
  document.getElementById("screenCheckout").classList.remove("active");
  document.getElementById("screenSale").classList.add("active");
}
function updatePayDisplay() {
  document.getElementById("receivedPrice").innerText = Number(payReceivedStr).toLocaleString();
}
function inputNumPay(num) {
  soundEffect('tap');
  if (isPayConfirmed) resetPayConfirmState();
  if (payReceivedStr.length >= 7 && payReceivedStr !== "0") return;
  payReceivedStr = (payReceivedStr === "0") ? String(num) : payReceivedStr + String(num);
  updatePayDisplay();
}
function clearInputPay() {
  soundEffect('clear');
  payReceivedStr = "0";
  updatePayDisplay();
  resetPayConfirmState();
  document.getElementById("changePrice").innerText = "0";
}
function backspacePay() {
  soundEffect('backspace');
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
    if (received < currentTotalBilling) {
      soundEffect('error');
      alert("受領金額が請求金額を下回っています");
      return;
    }
    soundEffect('confirm');
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
  soundEffect('success');
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
  showSuccessModal("販売完了", `${sheets}セット  ${currentTotalBilling.toLocaleString()}円`, false);
}

// ── 7. 返金処理画面 ──
function openRefundScreen() {
  soundEffect('tap');
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenRefund").classList.add("active");
  clearInputRefund();
  document.getElementById("refundKeypadTray").classList.remove("tray-collapsed");
}
function closeRefundScreen() {
  soundEffect('tap');
  document.getElementById("screenRefund").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}
function updateRefundDisplay() {
  document.getElementById("refundSheetCount").innerText = Number(refundCountStr).toLocaleString();
}
function inputNumRefund(num) {
  soundEffect('tap');
  if (isRefundConfirmed) resetRefundConfirmState();
  if (refundCountStr.length >= 3 && refundCountStr !== "0") return;
  refundCountStr = (refundCountStr === "0") ? String(num) : refundCountStr + String(num);
  updateRefundDisplay();
}
function clearInputRefund() {
  soundEffect('clear');
  refundCountStr = "0";
  updateRefundDisplay();
  resetRefundConfirmState();
  document.getElementById("refundTotalPrice").innerText = "0";
}
function backspaceRefund() {
  soundEffect('backspace');
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
  if (!isRefundConfirmed) {
    const count = Number(refundCountStr);
    if (count <= 0) {
      soundEffect('error');
      alert("バラ返金枚数を入力してください");
      return;
    }
    soundEffect('confirm');
    const totalRefund = count * REFUND_UNIT_PRICE;
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
  soundEffect('refund');
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const sheets = Number(refundCountStr);
  const refundAmount = sheets * REFUND_UNIT_PRICE;

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
  showSuccessModal("返金完了", `${sheets}枚 (バラ)  -${refundAmount.toLocaleString()}円`, true);
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

// ── 9. 集計・管理画面 ──
function openManageScreen() {
  soundEffect('tap');
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenManage").classList.add("active");

  renderAllManageViews();
  if (navigator.onLine) fetchFromGAS(false);
}
function closeManageScreen() {
  soundEffect('tap');
  document.getElementById("screenManage").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}

function switchMainTab(tab) {
  soundEffect('tap');
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
  soundEffect('tap');
  saleSubTab = sub;
  document.getElementById("subTabActive").classList.toggle("active", sub === "active");
  document.getElementById("subTabTrash").classList.toggle("active", sub === "trash");
  document.getElementById("activeActionBar").style.display = (sub === "active") ? "flex" : "none";
  renderSaleTable();
}

function renderAllManageViews() {
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

  document.getElementById("saleTabTotalSheets").innerText = `${totalSaleSheets.toLocaleString()} セット`;
  document.getElementById("saleTabTotalSales").innerText = `${totalSaleAmount.toLocaleString()} 円`;
  document.getElementById("saleTabTotalOrders").innerText = `${orderHistory.length.toLocaleString()} 件`;
  document.getElementById("trashCountBadge").innerText = trashHistory.length;

  document.getElementById("refundTabTotalSheets").innerText = `${totalRefundSheets.toLocaleString()} 枚`;
  document.getElementById("refundTabTotalAmount").innerText = `-${totalRefundAmount.toLocaleString()} 円`;
  document.getElementById("refundTabTotalOrders").innerText = `${refundHistory.length.toLocaleString()} 件`;

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
      <th>販売数</th>
      <th>受領額</th>
      <th>釣銭</th>
      <th>操作</th>
    `;

    orderHistory.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="td-chk"><input type="checkbox" class="row-chk" value="${item.id}" onchange="onRowCheckChange()"></td>
        <td><strong>${item.no}</strong></td>
        <td>${cleanTimeStr(item.time)}</td>
        <td><strong>${item.sheetCount}</strong> セット</td>
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
      <th>販売数</th>
      <th>金額</th>
      <th>削除日時</th>
      <th>操作</th>
    `;

    if (trashHistory.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">削除されたデータはありません</td></tr>`;
      return;
    }

    trashHistory.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong style="color:#ef4444;">${item.no}</strong></td>
        <td>${cleanTimeStr(item.time)}</td>
        <td>${item.sheetCount} セット</td>
        <td>${(item.sheetCount * UNIT_PRICE).toLocaleString()} 円</td>
        <td style="font-size:0.75rem; color:#64748b;">${cleanTimeStr(item.deletedAt)}</td>
        <td><button class="btn-row-restore" onclick="restoreRow('${item.id}')">↩ 復元</button></td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function renderRefundTable() {
  const tbody = document.getElementById("refundTableBody");
  tbody.innerHTML = "";

  if (refundHistory.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">返金データはありません</td></tr>`;
    return;
  }

  refundHistory.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong style="color:#dc2626;">R-${item.no}</strong></td>
      <td>${cleanTimeStr(item.time)}</td>
      <td><strong>${item.sheetCount}</strong> 枚</td>
      <td style="color:#dc2626; font-weight:bold;">-${item.amount.toLocaleString()} 円</td>
      <td><button class="btn-row-delete-refund" onclick="deleteRefundRow('${item.id}')">削除</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleSelectAll(master) {
  soundEffect('tap');
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
  soundEffect('confirm');

  const now = new Date();
  const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
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

  soundEffect('confirm');
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

async function deleteRefundRow(id) {
  if (!confirm("この返金記録を削除しますか？\n（スプレッドシートからも行が削除されます）")) return;
  soundEffect('confirm');

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
  soundEffect('tap');
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
  soundEffect('tap');
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
  if (sheets <= 0) {
    soundEffect('error');
    alert("セット数は1セット以上にしてください");
    return;
  }
  if (received < (sheets * UNIT_PRICE)) {
    soundEffect('error');
    alert("受領金額が不足しています");
    return;
  }

  soundEffect('confirm');
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
  soundEffect('tap');
  document.getElementById("screenMenu").classList.remove("active");
  document.getElementById("screenSettings").classList.add("active");

  document.getElementById("settingUnitPrice").value = UNIT_PRICE;
  document.getElementById("settingRefundUnitPrice").value = REFUND_UNIT_PRICE;
  document.getElementById("settingGasUrl").value = GAS_URL;

  selectedSettingDay = currentDay;
  updateSettingsDayView();
  updateProdModeUI();
}
function closeSettingsScreen() {
  soundEffect('tap');
  document.getElementById("screenSettings").classList.remove("active");
  document.getElementById("screenMenu").classList.add("active");
}

function selectDaySetting(day) {
  soundEffect('tap');
  selectedSettingDay = day;
  updateSettingsDayView();
}

function updateSettingsDayView() {
  document.getElementById("btnDay1").classList.toggle("active", selectedSettingDay === "1");
  document.getElementById("btnDay2").classList.toggle("active", selectedSettingDay === "2");
  document.getElementById("initialCashLabelDay").innerText = `${selectedSettingDay}日目`;
  document.getElementById("startDayBtnText").innerText = `${selectedSettingDay}日目を開始`;

  const savedInit = localStorage.getItem(`pos_initial_cash_${selectedSettingDay}`) || "";
  document.getElementById("settingInitialCash").value = savedInit;
}

function startSelectedDay() {
  const initVal = document.getElementById("settingInitialCash").value.trim();

  if (isProdMode) {
    if (!initVal || Number(initVal) < 0) {
      soundEffect('error');
      alert("【エラー】本番稼働中のため、開始前の有高（釣銭準備金）の入力が必須です！\n開始前の有高が入力されていません！");
      return;
    }
  }

  soundEffect('confirm');
  if (initVal !== "") {
    localStorage.setItem(`pos_initial_cash_${selectedSettingDay}`, Number(initVal));
  }

  currentDay = selectedSettingDay;
  localStorage.setItem("pos_current_day", currentDay);

  orderHistory = JSON.parse(localStorage.getItem(`pos_sales_data_${currentDay}`) || "[]");
  refundHistory = JSON.parse(localStorage.getItem(`pos_refund_data_${currentDay}`) || "[]");
  trashHistory = JSON.parse(localStorage.getItem(`pos_trash_data_${currentDay}`) || "[]");

  updateDayUI();
  if (navigator.onLine) fetchFromGAS(false);

  alert(`「${currentDay}日目」を開始しました！\n（準備金: ${initVal ? Number(initVal).toLocaleString() + "円" : "未設定"}）`);
  closeSettingsScreen();
}

function requestToggleProdMode() {
  soundEffect('tap');
  const nextMode = !isProdMode;
  const prompt = nextMode
    ? "本番モードを【ON】にします。管理者パスキーを入力してください:"
    : "本番モードを解除し【テストモード】にします。管理者パスキーを入力してください:";

  openPasskeyModal(prompt, () => {
    isProdMode = nextMode;
    localStorage.setItem("pos_is_prod_mode", isProdMode);
    updateProdModeUI();
    soundEffect('confirm');
    alert(`本番モードを「${isProdMode ? "ON (本番)" : "OFF (テスト)"}」に変更しました。`);
  });
}

function saveUnitPriceSettings() {
  const setPrice = Number(document.getElementById("settingUnitPrice").value);
  const refPrice = Number(document.getElementById("settingRefundUnitPrice").value);

  if (setPrice <= 0 || refPrice <= 0) {
    soundEffect('error');
    alert("有効な価格を入力してください");
    return;
  }
  soundEffect('confirm');
  UNIT_PRICE = setPrice;
  REFUND_UNIT_PRICE = refPrice;

  localStorage.setItem("pos_unit_price", UNIT_PRICE);
  localStorage.setItem("pos_refund_unit_price", REFUND_UNIT_PRICE);
  updateDayUI();

  alert(`金券単価を更新しました！\n・セット販売単価: ${UNIT_PRICE.toLocaleString()}円\n・バラ返金単価: ${REFUND_UNIT_PRICE.toLocaleString()}円`);
}

function saveGasUrlSetting() {
  const url = document.getElementById("settingGasUrl").value.trim();
  if (!url.startsWith("https://script.google.com/")) {
    soundEffect('error');
    alert("正しいGoogle Apps ScriptのURLを入力してください。");
    return;
  }
  soundEffect('confirm');
  GAS_URL = url;
  localStorage.setItem("pos_gas_url", GAS_URL);
  alert("スプレッドシート連携URLを更新しました！");
  if (navigator.onLine) fetchFromGAS(false);
}

// ── 13. 初期化（分離版） ──
function requestResetLocalOnly() {
  soundEffect('tap');
  openPasskeyModal("端末データのみ初期化します。管理者パスキーを入力:", () => {
    if (confirm("【確認】この端末内の販売・返金キャッシュデータを初期化しますか？\n（スプレッドシート側のデータは保持されます）")) {
      executeResetLocal();
    }
  });
}

function executeResetLocal() {
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
  localStorage.removeItem("pos_initial_cash_1");
  localStorage.removeItem("pos_initial_cash_2");

  saveCurrentDayStorage();
  renderAllManageViews();
  updateOnlineStatus();

  soundEffect('confirm');
  alert("端末のローカルデータを初期化しました！");
}

function requestResetSheetData() {
  soundEffect('tap');
  openPasskeyModal("⚠️ スプシデータも完全消去します。管理者パスキーを入力:", () => {
    if (confirm(`【超危険】Googleスプレッドシートの「販売データ${currentDay}」「返金データ${currentDay}」「削除履歴${currentDay}」の行を全消去します。\n本当によろしいですか？`)) {
      executeResetSheetData();
    }
  });
}

async function executeResetSheetData() {
  executeResetLocal();

  if (navigator.onLine) {
    try {
      await sendPostToGAS("clear_sheet_data", {});
      soundEffect('confirm');
      alert(`スプレッドシート（${currentDay}日目）の全データを消去しました！`);
      fetchFromGAS(false);
    } catch (e) {
      soundEffect('error');
      alert("スプレッドシート通信エラーにより消去できませんでした。");
    }
  } else {
    soundEffect('error');
    alert("オフラインのためスプレッドシートの消去は実行できません。");
  }
}

// ── 14. 貸借対照表 (T勘定) 精算モーダル ──
let currentSettleCalculated = {};

function openSettlementModal() {
  soundEffect('tap');
  document.getElementById("settleDayTitle").innerText = `${currentDay}日目`;
  document.getElementById("settleDateTime").innerText = new Date().toLocaleString();

  const savedInit = Number(localStorage.getItem(`pos_initial_cash_${currentDay}`) || 0);
  document.getElementById("settleInitialCash").value = savedInit;

  document.getElementById("settleExtraIncome").value = 0;
  document.getElementById("settleExtraExpense").value = 0;
  document.getElementById("settleActualCash").value = "";

  recalcSettlement();
  document.getElementById("settlementModal").classList.add("show");
}

function closeSettlementModal() {
  soundEffect('tap');
  document.getElementById("settlementModal").classList.remove("show");
}

function recalcSettlement() {
  const initCash = Number(document.getElementById("settleInitialCash").value || 0);

  let totalReceived = 0;
  let totalChange = 0;
  orderHistory.forEach(item => {
    totalReceived += item.received;
    totalChange += item.change;
  });

  let totalRefund = 0;
  refundHistory.forEach(item => {
    totalRefund += item.amount;
  });

  const extraIncome = Number(document.getElementById("settleExtraIncome").value || 0);
  const extraExpense = Number(document.getElementById("settleExtraExpense").value || 0);

  document.getElementById("settleTotalReceived").innerText = totalReceived.toLocaleString();
  document.getElementById("settleTotalChange").innerText = totalChange.toLocaleString();
  document.getElementById("settleTotalRefund").innerText = totalRefund.toLocaleString();

  const leftTotal = initCash + totalReceived + extraIncome;
  const rightTotal = totalChange + totalRefund + extraExpense;

  document.getElementById("settleLeftTotal").innerText = `${leftTotal.toLocaleString()} 円`;
  document.getElementById("settleRightTotal").innerText = `${rightTotal.toLocaleString()} 円`;

  const bookBalance = leftTotal - rightTotal;
  document.getElementById("settleBookBalance").innerText = `${bookBalance.toLocaleString()} 円`;

  const actualInput = document.getElementById("settleActualCash").value;
  const diffCard = document.getElementById("settleDiffCard");
  const diffEl = document.getElementById("settleDifference");

  if (actualInput === "") {
    diffCard.className = "reconcile-diff-card";
    diffEl.innerText = "手元現金を実査入力してください";
    diffEl.style.fontSize = "0.95rem";
  } else {
    diffEl.style.fontSize = "1.45rem";
    const actualCash = Number(actualInput);
    const diff = actualCash - bookBalance;

    if (diff === 0) {
      diffCard.className = "reconcile-diff-card match";
      diffEl.innerText = "±0 円 (一致✨ 差異なし)";
    } else if (diff > 0) {
      diffCard.className = "reconcile-diff-card diff-gain";
      diffEl.innerText = `+${diff.toLocaleString()} 円 (雑益 / 余剰)`;
    } else {
      diffCard.className = "reconcile-diff-card diff-loss";
      diffEl.innerText = `${diff.toLocaleString()} 円 (雑損 / 不足)`;
    }

    currentSettleCalculated = {
      settledAt: new Date().toLocaleString(),
      day: currentDay,
      initialCash: initCash,
      totalReceived: totalReceived,
      totalChange: totalChange,
      totalRefund: totalRefund,
      extraIncome: extraIncome,
      extraExpense: extraExpense,
      bookBalance: bookBalance,
      actualCash: actualCash,
      difference: diff
    };
  }
}

function requestConfirmSettlement() {
  const actualInput = document.getElementById("settleActualCash").value;
  if (actualInput === "") {
    soundEffect('error');
    alert("実際の手元現金額を入力してください。");
    return;
  }

  soundEffect('tap');
  openPasskeyModal("精算を確定し記録します。管理者パスキーを入力:", async () => {
    if (confirm(`【精算確定】\n${currentDay}日目の精算を確定しスプレッドシートへ記録しますか？\n（帳簿残高: ${currentSettleCalculated.bookBalance.toLocaleString()}円 / 実際有高: ${currentSettleCalculated.actualCash.toLocaleString()}円）`)) {
      soundEffect('confirm');
      if (navigator.onLine) {
        try {
          await sendPostToGAS("save_settlement", { data: currentSettleCalculated });
          alert(`「${currentDay}日目」の精算データをスプレッドシートに記録しました！`);
          closeSettlementModal();
        } catch (e) {
          soundEffect('error');
          alert("記録中に通信エラーが発生しました。");
        }
      } else {
        enqueueOrSend("save_settlement", { data: currentSettleCalculated });
        alert(`オフラインのためキューに保持しました。\n次回オンライン時にスプレッドシートへ記録されます。`);
        closeSettlementModal();
      }
    }
  });
}

// ── 15. パスキー認証モーダル（設定・リセット・精算時用） ──
function openPasskeyModal(promptText, callback) {
  passkeyEntered = "";
  passkeySuccessCallback = callback;
  document.getElementById("passkeyInput").value = "";
  document.getElementById("passkeyErrorMsg").innerText = "";
  document.getElementById("passkeyPromptText").innerText = promptText;
  document.getElementById("passkeyModal").classList.add("show");
}

function closePasskeyModal() {
  soundEffect('tap');
  document.getElementById("passkeyModal").classList.remove("show");
  passkeyEntered = "";
}

function inputPasskey(num) {
  soundEffect('tap');
  if (passkeyEntered.length >= 4) return;
  passkeyEntered += num;
  document.getElementById("passkeyInput").value = passkeyEntered;

  if (passkeyEntered.length === 4) {
    if (passkeyEntered === ADMIN_PASSKEY) {
      soundEffect('confirm');
      const cb = passkeySuccessCallback;
      closePasskeyModal();
      if (cb) setTimeout(cb, 250);
    } else {
      soundEffect('error');
      document.getElementById("passkeyErrorMsg").innerText = "パスキーが正しくありません";
      setTimeout(clearPasskey, 500);
    }
  }
}

function clearPasskey() {
  soundEffect('clear');
  passkeyEntered = "";
  document.getElementById("passkeyInput").value = "";
  document.getElementById("passkeyErrorMsg").innerText = "";
}

function backspacePasskey() {
  soundEffect('backspace');
  passkeyEntered = passkeyEntered.slice(0, -1);
  document.getElementById("passkeyInput").value = passkeyEntered;
  document.getElementById("passkeyErrorMsg").innerText = "";
}

function saveCurrentDayStorage() {
  localStorage.setItem(`pos_sales_data_${currentDay}`, JSON.stringify(orderHistory));
  localStorage.setItem(`pos_refund_data_${currentDay}`, JSON.stringify(refundHistory));
  localStorage.setItem(`pos_trash_data_${currentDay}`, JSON.stringify(trashHistory));
}

// ── 16. オフラインキュー ＆ 通信処理 ──
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
  // ロック解除前は同期通信もブロック
  if (!isAppUnlocked && !isManual) return;
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
      console.log(`スプシ同期完了（${currentDay}日目）`);
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

// 起動時初期化
updateSoundUI();
updateDayUI();
updateProdModeUI();