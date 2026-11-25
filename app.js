import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, push, set, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// 已綁定你的 Firebase 資料庫網址
const firebaseConfig = {
    databaseURL: "https://our-ledger-2b0cc-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const txRef = ref(db, 'transactions');
const logsRef = ref(db, 'logs');

// 狀態管理
let transactions = {};
let logs = [];
let currentTab = 'all';
let currentOperator = localStorage.getItem('ledger_operator') || 'Benson';
let currentNetBalance = 0;

// 初始化操作者顯示
function initOperator() {
    document.querySelectorAll('.user-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.user === currentOperator);
    });
}
initOperator();

window.setOperator = (name) => {
    currentOperator = name;
    localStorage.setItem('ledger_operator', name);
    initOperator();
};

// 監聽連線狀態
onValue(ref(db, '.info/connected'), (snap) => {
    const badge = document.getElementById('syncStatus');
    if (snap.val() === true) {
        badge.classList.add('online');
        badge.innerHTML = '<span class="sync-dot"></span> <span>即時同步中</span>';
    } else {
        badge.classList.remove('online');
        badge.innerHTML = '<span class="sync-dot"></span> <span>重新連線中…</span>';
    }
});

// 監聽帳目資料變化
onValue(txRef, (snapshot) => {
    transactions = snapshot.val() || {};
    calculateBalance();
    renderList();
});

// 監聽修改日誌變化
onValue(logsRef, (snapshot) => {
    const data = snapshot.val() || {};
    logs = Object.values(data).sort((a, b) => b.timestamp - a.timestamp);
    if (currentTab === 'logs') renderList();
});

// 寫入操作日誌
function addLog(message) {
    const now = new Date();
    const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    push(logsRef, {
        operator: currentOperator,
        message: message,
        timeStr: timeStr,
        timestamp: Date.now()
    });
}

// 計算誰欠誰多少錢
function calculateBalance() {
    let peiyunOwesBenson = 0;
    let pendingCount = 0;

    Object.values(transactions).forEach(tx => {
        if (tx.isPending) {
            pendingCount++;
            return;
        }
        const amt = parseFloat(tx.amount) || 0;
        if (tx.type === 'settlement') {
            if (tx.payer === '佩筠') peiyunOwesBenson -= amt;
            if (tx.payer === 'Benson') peiyunOwesBenson += amt;
        } else {
            const share = tx.splitType === 'split' ? amt / 2 : amt;
            if (tx.payer === 'Benson') {
                peiyunOwesBenson += share;
            } else if (tx.payer === '佩筠') {
                peiyunOwesBenson -= share;
            }
        }
    });

    currentNetBalance = peiyunOwesBenson;

    // 更新待補數量標籤
    const badge = document.getElementById('pendingCount');
    badge.textContent = pendingCount;
    badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';

    // 更新看板文字與金額
    const labelEl = document.getElementById('settlementText');
    const amountEl = document.getElementById('settlementAmount');

    if (Math.abs(peiyunOwesBenson) < 0.1) {
        labelEl.innerHTML = '🎉 目前雙方帳目已完全結清！';
        amountEl.textContent = 'NT$ 0';
    } else if (peiyunOwesBenson > 0) {
        labelEl.innerHTML = '<strong class="peiyun">佩筠</strong> 要給 <strong class="benson">Benson</strong>';
        amountEl.textContent = `NT$ ${peiyunOwesBenson.toLocaleString()}`;
    } else {
        labelEl.innerHTML = '<strong class="benson">Benson</strong> 要給 <strong class="peiyun">佩筠</strong>';
        amountEl.textContent = `NT$ ${Math.abs(peiyunOwesBenson).toLocaleString()}`;
    }
}

// 切換分頁
window.switchTab = (tab) => {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });
    renderList();
};

// 渲染畫面列表
function renderList() {
    const container = document.getElementById('contentList');
    container.innerHTML = '';

    if (currentTab === 'logs') {
        if (logs.length === 0) {
            container.innerHTML = '<div class="empty-state">尚無任何修改紀錄</div>';
            return;
        }
        logs.forEach(log => {
            const div = document.createElement('div');
            div.className = 'log-card';
            div.innerHTML = `
                <div>✏️ <strong>${log.operator}</strong> ${log.message}</div>
                <div class="log-time">${log.timeStr}</div>
            `;
            container.appendChild(div);
        });
        return;
    }

    // 取得帳目陣列並依日期新到舊排序
    let items = Object.entries(transactions).map(([id, val]) => ({ id, ...val }));
    if (currentTab === 'pending') {
        items = items.filter(item => item.isPending);
    }

    items.sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (items.length === 0) {
        container.innerHTML = `<div class="empty-state">${currentTab === 'pending' ? '目前沒有待補金額的項目 ✨' : '還沒有任何帳目，點擊上方「記一筆」開始吧！'}</div>`;
        return;
    }

    items.forEach(tx => {
        const card = document.createElement('div');
        const isBenson = tx.payer === 'Benson';
        const avatarClass = isBenson ? 'benson' : 'peiyun';
        const avatarImg = isBenson ? 'benson.png' : 'peiyun.jpg';
        const avatarHtml = `<img src="${avatarImg}" alt="${tx.payer}">`;

        if (tx.type === 'settlement') {
            card.className = 'tx-card settlement';
            card.innerHTML = `
                <div class="tx-top">
                    <div class="tx-left">
                        <div class="avatar ${avatarClass}">還款</div>
                        <div>
                            <div class="tx-title">${tx.payer} 還款給 ${tx.payer === 'Benson' ? '佩筠' : 'Benson'}</div>
                            <div class="tx-meta"><span>📅 ${tx.date}</span></div>
                        </div>
                    </div>
                    <div class="tx-amount" style="color: var(--success-color);">NT$ ${Number(tx.amount).toLocaleString()}</div>
                </div>
                <div class="tx-footer">
                    <span>${tx.lastEditNote || ''}</span>
                    <div class="tx-actions">
                        <button class="action-btn delete" onclick="deleteTx('${tx.id}')">撤銷</button>
                    </div>
                </div>
            `;
        } else {
            card.className = `tx-card ${tx.isPending ? 'pending' : ''}`;
            const splitBadge = tx.splitType === 'split'
                ? '<span class="tag split">兩人平分</span>'
                : `<span class="tag advance">${isBenson ? '佩筠' : 'Benson'} 負擔（代墊）</span>`;

            card.innerHTML = `
                <div class="tx-top">
                    <div class="tx-left">
                        <div class="avatar ${avatarClass}">${avatarHtml}</div>
                        <div>
                            <div class="tx-title">${tx.item}</div>
                            <div class="tx-meta">
                                <span>📅 ${tx.date}</span>
                                <span>${tx.payer} 付</span>
                                ${splitBadge}
                                <span class="tag">${tx.category || '一般'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="tx-amount ${tx.isPending ? 'pending-text' : ''}">
                        ${tx.isPending ? '金額待補' : `NT$ ${Number(tx.amount).toLocaleString()}`}
                    </div>
                </div>
                <div class="tx-footer">
                    <span>${tx.lastEditNote || ''}</span>
                    <div class="tx-actions">
                        ${tx.isPending
                            ? `<button class="action-btn fill" onclick="openTxModal('${tx.id}')">補金額</button>`
                            : `<button class="action-btn" onclick="openTxModal('${tx.id}')">修改</button>`
                        }
                        <button class="action-btn delete" onclick="deleteTx('${tx.id}')">撤銷</button>
                    </div>
                </div>
            `;
        }
        container.appendChild(card);
    });
}

// 表單互動邏輯
window.selectRadio = (groupId, val) => {
    document.querySelectorAll(`#${groupId} .radio-btn`).forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.val === val);
    });
};

function getRadioVal(groupId) {
    const selected = document.querySelector(`#${groupId} .radio-btn.selected`);
    return selected ? selected.dataset.val : '';
}

window.togglePendingInput = () => {
    const isPending = document.getElementById('txPending').checked;
    const amtInput = document.getElementById('txAmount');
    amtInput.disabled = isPending;
    if (isPending) amtInput.value = '';
};

// 開啟新增/修改視窗
window.openTxModal = (editId = null) => {
    document.getElementById('txForm').reset();
    document.getElementById('editTxId').value = editId || '';
    document.getElementById('txAmount').disabled = false;

    if (editId && transactions[editId]) {
        const tx = transactions[editId];
        document.getElementById('modalTitle').textContent = tx.isPending ? '補上消費金額' : '修改消費明細';
        document.getElementById('txItem').value = tx.item;
        document.getElementById('txAmount').value = tx.isPending ? '' : tx.amount;
        document.getElementById('txPending').checked = false;
        document.getElementById('txDate').value = tx.date;
        document.getElementById('txCategory').value = tx.category || '餐飲';
        selectRadio('payerGroup', tx.payer);
        selectRadio('splitGroup', tx.splitType);
    } else {
        document.getElementById('modalTitle').textContent = '新增一筆消費';
        document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
        selectRadio('payerGroup', currentOperator);
        selectRadio('splitGroup', 'split');
    }

    document.getElementById('txModal').classList.add('open');
};

// 開啟還款視窗
window.openSettleModal = () => {
    const absAmt = Math.abs(currentNetBalance);
    document.getElementById('settleAmount').value = absAmt > 0 ? absAmt : '';
    if (currentNetBalance >= 0) {
        selectRadio('settleDirGroup', '佩筠->Benson');
    } else {
        selectRadio('settleDirGroup', 'Benson->佩筠');
    }
    document.getElementById('settleModal').classList.add('open');
};

window.closeModals = () => {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.classList.remove('open'));
};

// 儲存消費明細
window.saveTransaction = (e) => {
    e.preventDefault();
    const editId = document.getElementById('editTxId').value;
    const item = document.getElementById('txItem').value.trim();
    const isPending = document.getElementById('txPending').checked;
    const amount = isPending ? 0 : parseFloat(document.getElementById('txAmount').value);
    const payer = getRadioVal('payerGroup');
    const splitType = getRadioVal('splitGroup');
    const date = document.getElementById('txDate').value;
    const category = document.getElementById('txCategory').value;

    if (!isPending && (isNaN(amount) || amount <= 0)) {
        alert('請輸入正確的金額，或勾選「金額待補」');
        return;
    }

    const now = new Date();
    const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (editId && transactions[editId]) {
        const oldTx = transactions[editId];
        const actionText = oldTx.isPending && !isPending ? '補上金額' : '修改';
        const oldAmtText = oldTx.isPending ? '待補' : oldTx.amount;
        const newAmtText = isPending ? '待補' : amount;

        update(ref(db, `transactions/${editId}`), {
            item, amount, isPending, payer, splitType, date, category,
            lastEditNote: `✏️ ${currentOperator} 於 ${timeStr} ${actionText}`
        });

        addLog(`修改：${oldTx.item} ${oldAmtText} → ${item} ${newAmtText}（${payer} 付；${date}）`);
    } else {
        push(txRef, {
            type: 'expense',
            item, amount, isPending, payer, splitType, date, category,
            createdAt: Date.now(),
            lastEditNote: `📝 ${currentOperator} 於 ${timeStr} 新增`
        });

        addLog(`新增：${item} ${isPending ? '(金額待補)' : `NT$ ${amount}`}（${payer} 付；${date}）`);
    }

    closeModals();
};

// 儲存還款
window.saveSettlement = (e) => {
    e.preventDefault();
    const dir = getRadioVal('settleDirGroup');
    const payer = dir.split('->')[0];
    const amount = parseFloat(document.getElementById('settleAmount').value);
    const date = new Date().toISOString().split('T')[0];

    const now = new Date();
    const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    push(txRef, {
        type: 'settlement',
        payer,
        amount,
        date,
        isPending: false,
        createdAt: Date.now(),
        lastEditNote: `💸 ${currentOperator} 於 ${timeStr} 記錄還款`
    });

    addLog(`記錄還款：${payer} 還給 ${payer === 'Benson' ? '佩筠' : 'Benson'} NT$ ${amount}`);
    closeModals();
};

// 撤銷（刪除）帳目
window.deleteTx = (id) => {
    const tx = transactions[id];
    if (!tx) return;
    if (!confirm(`確定要撤銷「${tx.type === 'settlement' ? '還款紀錄' : tx.item}」嗎？`)) return;

    remove(ref(db, `transactions/${id}`));
    addLog(`撤銷了：${tx.type === 'settlement' ? `還款 NT$ ${tx.amount}` : `${tx.item} (${tx.isPending ? '待補' : `NT$ ${tx.amount}`})`}`);
};
