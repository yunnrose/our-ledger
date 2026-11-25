import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, push, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
    databaseURL: "https://our-ledger-2b0cc-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const txRef = ref(db, 'transactions');
const logsRef = ref(db, 'logs');

let transactions = {};
let logs = [];
let currentOperator = localStorage.getItem('ledger_operator') || 'Benson';
let quickPayer = currentOperator;
let quickSplit = 'split';
let quickPending = false;
let filterPendingOnly = false;
let currentNetBalance = 0;

// 初始化身份與預設付款人
function initUI() {
    document.querySelectorAll('.sender-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.user === currentOperator);
    });
    setQuickPayer(currentOperator);
}
initUI();

window.setOperator = (name) => {
    currentOperator = name;
    localStorage.setItem('ledger_operator', name);
    initUI();
};

window.setQuickPayer = (payer) => {
    quickPayer = payer;
    document.querySelectorAll('.chip[data-payer]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.payer === payer);
    });
};

window.setQuickSplit = (split) => {
    quickSplit = split;
    document.querySelectorAll('.chip[data-split]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.split === split);
    });
};

window.toggleQuickPending = () => {
    quickPending = !quickPending;
    document.getElementById('quickPendingChip').classList.toggle('active', quickPending);
    const amtInput = document.getElementById('quickAmount');
    amtInput.disabled = quickPending;
    amtInput.placeholder = quickPending ? '待補' : '$ 金額';
    if (quickPending) amtInput.value = '';
};

window.togglePendingFilter = () => {
    filterPendingOnly = !filterPendingOnly;
    document.getElementById('pendingFilterBtn').classList.toggle('active', filterPendingOnly);
    renderChat();
};

// 連線狀態監聽
onValue(ref(db, '.info/connected'), (snap) => {
    const el = document.getElementById('syncStatus');
    if (snap.val() === true) {
        el.classList.add('online');
        el.textContent = '● 即時同步中';
    } else {
        el.classList.remove('online');
        el.textContent = '連線中…';
    }
});

// 監聽帳目
onValue(txRef, (snapshot) => {
    transactions = snapshot.val() || {};
    calculateBalance();
    renderChat();
});

// 監聽修改日誌
onValue(logsRef, (snapshot) => {
    const data = snapshot.val() || {};
    logs = Object.values(data).sort((a, b) => b.timestamp - a.timestamp);
});

function addLog(message) {
    const now = new Date();
    const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    push(logsRef, {
        operator: currentOperator,
        message,
        timeStr,
        timestamp: Date.now()
    });
}

function calculateBalance() {
    let peijunOwesBenson = 0;
    let pendingCount = 0;

    Object.values(transactions).forEach(tx => {
        if (tx.isPending) {
            pendingCount++;
            return;
        }
        const amt = parseFloat(tx.amount) || 0;
        if (tx.type === 'settlement') {
            if (tx.payer === '佩筠') peijunOwesBenson -= amt;
            if (tx.payer === 'Benson') peijunOwesBenson += amt;
        } else {
            const share = tx.splitType === 'split' ? amt / 2 : amt;
            if (tx.payer === 'Benson') peijunOwesBenson += share;
            else if (tx.payer === '佩筠') peijunOwesBenson -= share;
        }
    });

    currentNetBalance = peijunOwesBenson;
    document.getElementById('pendingCount').textContent = pendingCount;

    const labelEl = document.getElementById('settlementText');
    const amountEl = document.getElementById('settlementAmount');

    if (Math.abs(peijunOwesBenson) < 0.1) {
        labelEl.textContent = '🎉 目前完全結清';
        amountEl.textContent = 'NT$ 0';
    } else if (peijunOwesBenson > 0) {
        labelEl.textContent = '佩筠 要給 Benson';
        amountEl.textContent = `NT$ ${peijunOwesBenson.toLocaleString()}`;
    } else {
        labelEl.textContent = 'Benson 要給 佩筠';
        amountEl.textContent = `NT$ ${Math.abs(peijunOwesBenson).toLocaleString()}`;
    }
}

// 渲染聊天對話流（舊到新排列，最新訊息在最下方）
function renderChat() {
    const stream = document.getElementById('chatStream');
    stream.innerHTML = '';

    let items = Object.entries(transactions).map(([id, val]) => ({ id, ...val }));
    if (filterPendingOnly) {
        items = items.filter(item => item.isPending);
    }

    items.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.createdAt || 0) - (b.createdAt || 0);
    });

    if (items.length === 0) {
        stream.innerHTML = `<div class="empty-chat">${filterPendingOnly ? '目前沒有待補金額的訊息 ✨' : '在下方輸入第一筆消費，開始你們的記帳對話吧 💬'}</div>`;
        return;
    }

    let lastDate = '';

    items.forEach(tx => {
        // 日期分隔膠囊
        if (tx.date !== lastDate) {
            lastDate = tx.date;
            const dateDiv = document.createElement('div');
            dateDiv.className = 'date-divider';
            dateDiv.textContent = formatDateLabel(tx.date);
            stream.appendChild(dateDiv);
        }

        // 還款系統通知
        if (tx.type === 'settlement') {
            const sysDiv = document.createElement('div');
            sysDiv.className = 'system-pill';
            sysDiv.innerHTML = `
                <span>💸 ${tx.payer} 還款給 ${tx.payer === 'Benson' ? '佩筠' : 'Benson'} NT$ ${Number(tx.amount).toLocaleString()}</span>
                <button class="b-btn del" onclick="deleteTx('${tx.id}')">撤銷</button>
            `;
            stream.appendChild(sysDiv);
            return;
        }

        // 左右氣泡排版：Benson 在左 (benson.png)，佩筠 在右 (peiyun.jpg)
        const isBenson = tx.payer === 'Benson';
        const row = document.createElement('div');
        row.className = `msg-row ${isBenson ? 'left' : 'right'}`;

        const imgFile = isBenson ? 'benson.png' : 'peiyun.jpg';
        const fallbackTxt = isBenson ? 'Ben' : '佩筠';
        const splitText = tx.splitType === 'split'
            ? '<span class="b-tag split">兩人平分</span>'
            : `<span class="b-tag advance">${isBenson ? '佩筠' : 'Benson'}負擔</span>`;

        row.innerHTML = `
            <div class="msg-avatar">
                <img src="${imgFile}" alt="${tx.payer}" onerror="this.parentElement.textContent='${fallbackTxt}'">
            </div>
            <div class="msg-content">
                <div class="msg-sender-name">${tx.payer} 付錢 · ${tx.category || '一般'}</div>
                <div class="bubble ${tx.isPending ? 'pending' : ''}">
                    <div class="bubble-top">
                        <span class="bubble-item">${tx.item}</span>
                        <span class="bubble-amount ${tx.isPending ? 'pending-txt' : ''}">
                            ${tx.isPending ? '⏳ 待補' : `NT$ ${Number(tx.amount).toLocaleString()}`}
                        </span>
                    </div>
                    <div class="bubble-tags">
                        ${splitText}
                    </div>
                    <div class="bubble-footer">
                        <span>${tx.shortTime || ''}</span>
                        <div class="bubble-btns">
                            ${tx.isPending
                                ? `<button class="b-btn fill" onclick="openEditModal('${tx.id}')">補金額</button>`
                                : `<button class="b-btn" onclick="openEditModal('${tx.id}')">修改</button>`
                            }
                            <button class="b-btn del" onclick="deleteTx('${tx.id}')">撤銷</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        stream.appendChild(row);
    });

    // 自動捲動到最底部最新訊息
    stream.scrollTop = stream.scrollHeight;
}

function formatDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${d.getMonth() + 1}月${d.getDate()}日 (週${days[d.getDay()]})`;
}

// 底部快速送出記帳訊息
window.sendQuickTx = (e) => {
    e.preventDefault();
    const itemInput = document.getElementById('quickItem');
    const amtInput = document.getElementById('quickAmount');
    const item = itemInput.value.trim();
    const amount = quickPending ? 0 : parseFloat(amtInput.value);

    if (!quickPending && (isNaN(amount) || amount <= 0)) {
        alert('請輸入金額，或點選上方「待補」標籤喔！');
        return;
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const shortTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const category = document.getElementById('quickCategory').value;

    push(txRef, {
        type: 'expense',
        item,
        amount,
        isPending: quickPending,
        payer: quickPayer,
        splitType: quickSplit,
        date: todayStr,
        category,
        shortTime,
        createdAt: Date.now()
    });

    addLog(`新增：${item} ${quickPending ? '(金額待補)' : `NT$ ${amount}`}（${quickPayer} 付）`);

    itemInput.value = '';
    amtInput.value = '';
    if (quickPending) toggleQuickPending();
};

// 修改 / 補金額視窗
window.openEditModal = (id) => {
    const tx = transactions[id];
    if (!tx) return;
    document.getElementById('editTxId').value = id;
    document.getElementById('editModalTitle').textContent = tx.isPending ? '💰 補上消費金額' : '✏️ 修改這筆消費';
    document.getElementById('editItem').value = tx.item;
    document.getElementById('editAmount').value = tx.isPending ? '' : tx.amount;
    document.getElementById('editAmount').disabled = false;
    document.getElementById('editPending').checked = false;
    document.getElementById('editDate').value = tx.date;
    document.getElementById('editCategory').value = tx.category || '餐飲';
    selectRadio('editPayerGroup', tx.payer);
    selectRadio('editSplitGroup', tx.splitType);
    document.getElementById('editModal').classList.add('open');
};

window.toggleEditPending = () => {
    const isP = document.getElementById('editPending').checked;
    const inp = document.getElementById('editAmount');
    inp.disabled = isP;
    if (isP) inp.value = '';
};

window.saveEditedTx = (e) => {
    e.preventDefault();
    const id = document.getElementById('editTxId').value;
    const oldTx = transactions[id];
    if (!oldTx) return;

    const item = document.getElementById('editItem').value.trim();
    const isPending = document.getElementById('editPending').checked;
    const amount = isPending ? 0 : parseFloat(document.getElementById('editAmount').value);
    const payer = getRadioVal('editPayerGroup');
    const splitType = getRadioVal('editSplitGroup');
    const date = document.getElementById('editDate').value;
    const category = document.getElementById('editCategory').value;

    if (!isPending && (isNaN(amount) || amount <= 0)) {
        alert('請輸入正確金額');
        return;
    }

    update(ref(db, `transactions/${id}`), {
        item, amount, isPending, payer, splitType, date, category
    });

    const oldAmt = oldTx.isPending ? '待補' : oldTx.amount;
    const newAmt = isPending ? '待補' : amount;
    addLog(`修改：${oldTx.item} ${oldAmt} → ${item} ${newAmt}`);
    closeModals();
};

// 還款與歷史紀錄視窗
window.openSettleModal = () => {
    const absAmt = Math.abs(currentNetBalance);
    document.getElementById('settleAmount').value = absAmt > 0 ? absAmt : '';
    selectRadio('settleDirGroup', currentNetBalance >= 0 ? '佩筠->Benson' : 'Benson->佩筠');
    document.getElementById('settleModal').classList.add('open');
};

window.saveSettlement = (e) => {
    e.preventDefault();
    const payer = getRadioVal('settleDirGroup').split('->')[0];
    const amount = parseFloat(document.getElementById('settleAmount').value);
    const todayStr = new Date().toISOString().split('T')[0];

    push(txRef, {
        type: 'settlement',
        payer,
        amount,
        date: todayStr,
        isPending: false,
        createdAt: Date.now()
    });

    addLog(`還款：${payer} 還給 ${payer === 'Benson' ? '佩筠' : 'Benson'} NT$ ${amount}`);
    closeModals();
};

window.openLogsModal = () => {
    const list = document.getElementById('logsList');
    list.innerHTML = logs.length === 0
        ? '<div style="text-align:center;color:#8c7f7a;padding:20px;">尚無修改紀錄</div>'
        : logs.map(l => `<div class="log-item"><strong>${l.operator}</strong> ${l.message} <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px;">${l.timeStr}</div></div>`).join('');
    document.getElementById('logsModal').classList.add('open');
};

window.selectRadio = (groupId, val) => {
    document.querySelectorAll(`#${groupId} .radio-btn`).forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.val === val);
    });
};

function getRadioVal(groupId) {
    const sel = document.querySelector(`#${groupId} .radio-btn.selected`);
    return sel ? sel.dataset.val : '';
}

window.closeModals = () => {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.classList.remove('open'));
};

window.deleteTx = (id) => {
    const tx = transactions[id];
    if (!tx || !confirm(`確定要撤銷「${tx.type === 'settlement' ? '這筆還款' : tx.item}」嗎？`)) return;
    remove(ref(db, `transactions/${id}`));
    addLog(`撤銷：${tx.type === 'settlement' ? `還款 NT$ ${tx.amount}` : tx.item}`);
};
