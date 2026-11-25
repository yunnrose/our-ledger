import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, get, push, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./js/firebase-config.js";
import { calculateLedger, parseNaturalLanguage, taiwanDateString, validateSettlement, describeSettlement } from "./js/ledger-core.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const txRef = ref(db, "transactions");
const logsRef = ref(db, "logs");
let currentUser = null;
let currentMember = null;
let transactions = {};
let logs = [];
let quickPayer = "Benson";
let quickSplit = "split";
let quickPending = false;
let filterPendingOnly = false;
let netBalance = 0;
let stopTransactions = null;
let stopLogs = null;

const $ = (id) => document.getElementById(id);
const money = (n) => "NT$ " + Number(n || 0).toLocaleString("zh-TW");
const memberName = (name) => name === "佩筠" ? "佩筠" : "Benson";

function showAuthError(error) {
  const messages = {
    "auth/invalid-credential": "帳號或密碼錯誤。",
    "auth/invalid-email": "Email 格式不正確。",
    "auth/too-many-requests": "登入嘗試次數過多，請稍後再試。",
    "auth/network-request-failed": "網路連線失敗，請確認網路後重試。"
  };
  $("authError").textContent = messages[error.code] || "登入失敗，請確認帳號設定或聯絡管理者。";
}
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authError").textContent = "";
  $("loginSubmit").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (error) { showAuthError(error); }
  finally { $("loginSubmit").disabled = false; }
});
$("logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (stopTransactions) stopTransactions();
  if (stopLogs) stopLogs();
  stopTransactions = stopLogs = null;
  currentMember = null;
  $("authScreen").hidden = !!user;
  $("chatApp").hidden = !user;
  if (!user) return;
  try {
    const snap = await get(ref(db, "members/" + user.uid));
    const profile = snap.val();
    if (!profile || profile.active !== true || !["佩筠", "Benson"].includes(profile.name)) {
      await signOut(auth);
      $("authError").textContent = "此帳號尚未被授權加入聊天室，請聯絡管理者。";
      return;
    }
    currentMember = profile.name;
    $("currentIdentity").textContent = "已登入：" + currentMember;
    $("syncStatus").textContent = "● 身分已驗證，連線中";
    quickPayer = currentMember;
    updatePayerChips();
    stopTransactions = onValue(txRef, (snapshot) => {
      transactions = snapshot.val() || {};
      renderSummary();
      renderChat();
    }, () => $("syncStatus").textContent = "資料讀取失敗");
    stopLogs = onValue(logsRef, (snapshot) => {
      logs = Object.values(snapshot.val() || {}).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
    });
    onValue(ref(db, ".info/connected"), (snapshot) => {
      $("syncStatus").textContent = snapshot.val() ? "● 即時同步中" : "連線中…";
    });
  } catch (error) {
    await signOut(auth);
    $("authError").textContent = "無法讀取帳號授權資料，請確認 Firebase Rules 與 members 設定。";
  }
});

function audit(action, message, before = null, after = null) {
  if (!currentUser || !currentMember) return;
  return push(logsRef, {
    actorUid: currentUser.uid, actorName: currentMember, operator: currentMember,
    action, message, before, after, timestamp: Date.now(),
    timeStr: new Intl.DateTimeFormat("zh-TW", {timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date())
  });
}
function renderSummary() {
  const result = calculateLedger(transactions);
  netBalance = result.netBalance;
  $("pendingCount").textContent = result.pendingCount;
  const settlement = describeSettlement(netBalance);
  $("settlementText").textContent = settlement.label;
  $("settlementAmount").textContent = money(settlement.amount);
  if ($("monthlyExpense")) $("monthlyExpense").textContent = money(result.monthlyExpense);
  if ($("totalExpense")) $("totalExpense").textContent = money(result.totalExpense);
  if ($("bensonPaid")) $("bensonPaid").textContent = money(result.paid.Benson);
  if ($("peijunPaid")) $("peijunPaid").textContent = money(result.paid["佩筠"]);
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function renderChat() {
  const stream = $("chatStream");
  stream.replaceChildren();
  const items = Object.entries(transactions)
    .filter(([,tx]) => tx && !tx.isDeleted && (!filterPendingOnly || tx.isPending))
    .map(([id,tx]) => ({id,...tx}))
    .sort((a,b) => String(a.date||"").localeCompare(String(b.date||"")) || (a.createdAt||0)-(b.createdAt||0));
  if (!items.length) {
    stream.append(element("div","empty-chat",filterPendingOnly ? "目前沒有待補金額的訊息 ✨" : "在下方輸入第一筆消費，開始你們的記帳對話吧 💬"));
    return;
  }
  let lastDate = "";
  for (const tx of items) {
    if (tx.date !== lastDate) {
      lastDate = tx.date;
      const d = new Date(tx.date + "T00:00:00+08:00");
      stream.append(element("div","date-divider", Number.isNaN(d.getTime()) ? tx.date : new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",weekday:"short"}).format(d)));
    }
    if (tx.type === "settlement") {
      const pill = element("div","system-pill");
      const receiver = tx.receiver || (tx.payer === "Benson" ? "佩筠" : "Benson");
      pill.append(element("span","", "💸 " + tx.payer + " 還款給 " + receiver + " " + money(tx.amount)));
      const del = element("button","b-btn del","撤銷");
      del.type = "button"; del.addEventListener("click",()=>deleteTx(tx.id)); pill.append(del);
      stream.append(pill); continue;
    }
    const isBenson = tx.payer === "Benson";
    const row = element("div","msg-row " + (isBenson ? "left" : "right"));
    const avatar = element("div","msg-avatar", isBenson ? "Ben" : "佩筠");
    const img = document.createElement("img");
    img.src = isBenson ? "benson.png" : "peiyun.jpg"; img.alt = tx.payer;
    img.addEventListener("error",()=>img.remove()); avatar.replaceChildren(img);
    const content = element("div","msg-content");
    content.append(element("div","msg-sender-name", tx.payer + " 付款 · " + (tx.category || "一般")));
    const bubble = element("div","bubble" + (tx.isPending ? " pending" : ""));
    const top = element("div","bubble-top");
    top.append(element("span","bubble-item",tx.item || "未命名項目"));
    top.append(element("span","bubble-amount"+(tx.isPending?" pending-txt":""),tx.isPending?"⏳ 待補":money(tx.amount)));
    bubble.append(top);
    const tags = element("div","bubble-tags");
    tags.append(element("span","b-tag "+(tx.splitType==="split"?"split":"advance"),tx.splitType==="split"?"兩人平分":(isBenson?"佩筠":"Benson")+"負擔"));
    bubble.append(tags);
    const footer = element("div","bubble-footer");
    footer.append(element("span","",tx.shortTime || ""));
    const actions = element("div","bubble-btns");
    const edit = element("button","b-btn",tx.isPending?"補金額":"修改"); edit.type="button"; edit.addEventListener("click",()=>openEditModal(tx.id));
    const del = element("button","b-btn del","撤銷"); del.type="button"; del.addEventListener("click",()=>deleteTx(tx.id));
    actions.append(edit,del); footer.append(actions); bubble.append(footer); content.append(bubble); row.append(avatar,content); stream.append(row);
  }
  stream.scrollTop = stream.scrollHeight;
}
function updatePayerChips() {
  document.querySelectorAll(".chip[data-payer]").forEach(btn => btn.classList.toggle("active",btn.dataset.payer===quickPayer));
}
window.setQuickPayer = (payer) => { if (["Benson","佩筠"].includes(payer)) {quickPayer=payer;updatePayerChips();} };
window.setQuickSplit = (split) => {
  quickSplit = split;
  document.querySelectorAll(".chip[data-split]").forEach(btn=>btn.classList.toggle("active",btn.dataset.split===split));
};
window.toggleQuickPending = () => {
  quickPending=!quickPending; $("quickPendingChip").classList.toggle("active",quickPending);
  $("quickAmount").disabled=quickPending; $("quickAmount").placeholder=quickPending?"待補":"$ 金額";
  if(quickPending) $("quickAmount").value="";
};
window.togglePendingFilter = () => {
  filterPendingOnly=!filterPendingOnly; $("pendingFilterBtn").classList.toggle("active",filterPendingOnly); renderChat();
};
window.sendQuickTx = async (event) => {
  event.preventDefault(); if(!currentUser || !currentMember) return;
  const raw=$("quickItem").value.trim();
  if(!raw) return alert("請輸入記帳內容");
  const now=new Date();
  const parsed=parseNaturalLanguage(raw,currentMember,now);
  const hasNaturalAmount=/\d/.test(raw);
  const hasNaturalPending=/待補|金額未定|還沒確認金額/.test(raw);
  let tx;
  if(parsed.ok && (hasNaturalAmount || hasNaturalPending)) {
    tx={...parsed.transaction,category:$("quickCategory").value,
      shortTime:new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}).format(now),
      createdAt:Date.now(),createdByUid:currentUser.uid,createdBy:currentMember};
  } else {
    const amt=quickPending?0:Number($("quickAmount").value);
    if(!quickPending && (!Number.isSafeInteger(amt)||amt<=0)) {
      return alert(parsed.error || "請輸入正整數金額，或使用自然語句，例如：晚餐 850 Benson 付");
    }
    tx={type:"expense",item:raw,amount:amt,isPending:quickPending,payer:quickPayer,
      splitType:quickSplit,date:taiwanDateString(now),category:$("quickCategory").value,
      shortTime:new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}).format(now),
      createdAt:Date.now(),createdByUid:currentUser.uid,createdBy:currentMember};
  }
  try {
    await push(txRef,tx);
    await audit("create","新增："+tx.item+(tx.isPending?"（待補）":" "+money(tx.amount))+"（"+tx.payer+" 付款）",null,tx);
    $("quickItem").value="";$("quickAmount").value="";
    if(quickPending && $("quickPendingChip").classList.contains("active")) window.toggleQuickPending();
  } catch(e) { alert("新增失敗，請確認登入狀態與資料庫權限。"); }
};
window.openEditModal = (id) => {
  const tx=transactions[id]; if(!tx || tx.isDeleted) return;
  $("editTxId").value=id;$("editModalTitle").textContent=tx.isPending?"💰 補上消費金額":"✏️ 修改這筆消費";
  $("editItem").value=tx.item||"";$("editAmount").value=tx.isPending?"":tx.amount;$("editPending").checked=!!tx.isPending;
  $("editAmount").disabled=!!tx.isPending;$("editDate").value=tx.date||taiwanDateString();
  $("editCategory").value=tx.category||"餐飲";window.selectRadio("editPayerGroup",tx.payer);window.selectRadio("editSplitGroup",tx.splitType||"split");
  $("editModal").classList.add("open");
};
window.toggleEditPending=()=>{const p=$("editPending").checked;$("editAmount").disabled=p;if(p)$("editAmount").value="";};
window.saveEditedTx=async(event)=>{
  event.preventDefault();const id=$("editTxId").value,old=transactions[id];if(!old||old.isDeleted)return;
  const pending=$("editPending").checked,amount=pending?0:Number($("editAmount").value);
  const after={item:$("editItem").value.trim(),amount,isPending:pending,payer:getRadioVal("editPayerGroup"),splitType:getRadioVal("editSplitGroup"),date:$("editDate").value,category:$("editCategory").value};
  if(!after.item||(!pending&&(!Number.isSafeInteger(amount)||amount<=0))||!after.date||!["Benson","佩筠"].includes(after.payer)||!["split","advance"].includes(after.splitType))return alert("請確認項目、日期、付款人及正整數金額。");
  try{await update(ref(db,"transactions/"+id),{...after,updatedAt:Date.now(),updatedByUid:currentUser.uid,updatedBy:currentMember});await audit("update","修改："+old.item+" → "+after.item,old,after);window.closeModals();}
  catch(e){alert("修改失敗，請確認資料庫權限。");}
};
window.openSettleModal=()=>{
  const s=describeSettlement(netBalance);if(!s.amount)return alert("目前沒有待結清款項。");
  $("settleAmount").value=s.amount;window.selectRadio("settleDirGroup",s.debtor+"->"+s.creditor);$("settleModal").classList.add("open");
};
window.saveSettlement=async(event)=>{
  event.preventDefault();const [payer,receiver]=getRadioVal("settleDirGroup").split("->"),amount=Number($("settleAmount").value);
  const err=validateSettlement({payer,receiver,amount},netBalance);if(err)return alert(err);
  const tx={type:"settlement",payer,receiver,amount,date:taiwanDateString(),isPending:false,createdAt:Date.now(),createdByUid:currentUser.uid,createdBy:currentMember};
  try{await push(txRef,tx);await audit("settlement","還款："+payer+" 還給 "+receiver+" "+money(amount),null,tx);window.closeModals();}
  catch(e){alert("還款紀錄新增失敗。");}
};
window.deleteTx=async(id)=>{
  const tx=transactions[id];if(!tx||tx.isDeleted||!confirm("確定撤銷這筆紀錄？資料會保留在操作歷史中。"))return;
  try{const after={isDeleted:true,deletedAt:Date.now(),deletedByUid:currentUser.uid,deletedBy:currentMember};await update(ref(db,"transactions/"+id),after);await audit("void","撤銷紀錄："+(tx.item||"還款"),tx,after);}
  catch(e){alert("撤銷失敗，請確認資料庫權限。");}
};
window.openLogsModal=()=>{
  const list=$("logsList");list.replaceChildren();
  if(!logs.length)list.append(element("div","", "尚無修改紀錄"));
  for(const log of logs){const item=element("div","log-item");item.append(element("strong","",log.actorName||log.operator||"使用者"),document.createTextNode(" "+(log.message||"更新紀錄")),element("div","",log.timeStr||""));list.append(item);}
  $("logsModal").classList.add("open");
};
window.selectRadio=(groupId,val)=>document.querySelectorAll("#"+groupId+" .radio-btn").forEach(btn=>btn.classList.toggle("selected",btn.dataset.val===val));
function getRadioVal(groupId){return document.querySelector("#"+groupId+" .radio-btn.selected")?.dataset.val||"";}
window.closeModals=()=>document.querySelectorAll(".modal-backdrop").forEach(el=>el.classList.remove("open"));
