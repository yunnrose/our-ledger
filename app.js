import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, push, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
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
let filterPendingOnly = false;
let activeLedgerTab = "all";
let netBalance = 0;
let searchTerm = "";
let selectedDate = "";
let selectedCalendarDate = "";
let calendarDate = new Date();
let calcExpression = "";
let stopTransactions = null;
let stopLogs = null;

const $ = (id) => document.getElementById(id);
const money = (n) => "NT$ " + Number(n || 0).toLocaleString("zh-TW");
const memberName = (name) => name === "佩筠" ? "佩筠" : "Benson";

function startSharedRoom() {
  if (!currentUser || !currentMember) return;
  $("identityScreen").hidden = true;
  $("chatApp").hidden = false;
  $("currentIdentity").textContent = "操作身分：" + currentMember;
    if (stopTransactions) stopTransactions();
  if (stopLogs) stopLogs();
  stopTransactions = onValue(txRef, (snapshot) => {
    transactions = snapshot.val() || {};
    renderSummary();
    renderChat();
    if (!$("calendarPanel").hidden) renderCalendar();
    if (selectedCalendarDate && !$("calendarDayModal").hidden) renderCalendarDayModal(selectedCalendarDate);
  }, () => $("syncStatus").textContent = "資料讀取失敗");
  stopLogs = onValue(logsRef, (snapshot) => {
    logs = Object.values(snapshot.val() || {}).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
  });
  onValue(ref(db, ".info/connected"), (snapshot) => {
    $("syncStatus").textContent = snapshot.val() ? "● 即時同步中" : "連線中…";
  });
}
window.addEventListener("ledger-identity-selected", (event) => {
  const name = event.detail?.name;
  if (!["佩筠","Benson"].includes(name)) return;
  currentMember = name;
  localStorage.setItem("ledger_operator", name);
  if (currentUser) startSharedRoom();
  else $("identityError").textContent = "已選擇 " + name + "，正在建立安全連線…";
});
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    try { await signInAnonymously(auth); }
    catch (error) {
      $("identityScreen").hidden = false;
      $("chatApp").hidden = true;
      $("identityError").textContent = "無法連線至共享聊天室，請確認 Firebase 已啟用 Anonymous Authentication。";
    }
    return;
  }
  if (currentMember) {
    startSharedRoom();
  } else {
    $("identityScreen").hidden = false;
    $("chatApp").hidden = true;
    $("identityError").textContent = "";
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
  if ($("peijunShare")) $("peijunShare").textContent = money(result.share["佩筠"]);
  if ($("bensonShare")) $("bensonShare").textContent = money(result.share.Benson);
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
  const all = Object.entries(transactions)
    .filter(([,tx]) => tx && !tx.isDeleted && (!selectedDate || tx.date===selectedDate) &&
      (!searchTerm || (String(tx.item||"")+" "+String(tx.category||"")).toLowerCase().includes(searchTerm.toLowerCase())))
    .map(([id,tx]) => ({id,...tx}))
    .sort((a,b) => String(b.date||"").localeCompare(String(a.date||"")) || (b.createdAt||0)-(a.createdAt||0));
  if (activeLedgerTab === "details") {
    $("balanceDetails").hidden = false;
    const result = calculateLedger(transactions);
    const detail = element("section","detail-summary");
    detail.append(element("h3","","帳本統計"));
    [["本月支出",result.monthlyExpense],["累計支出",result.totalExpense],["Benson 已付款",result.paid.Benson],["佩筠 已付款",result.paid["佩筠"]],["Benson 應負擔",result.share.Benson],["佩筠 應負擔",result.share["佩筠"]]].forEach(([label,value])=>{
      const item=element("div","detail-stat");item.append(element("span","",label),element("strong","",money(value)));detail.append(item);
    });
    stream.append(detail); return;
  }
  $("balanceDetails").hidden = true;
  let items = activeLedgerTab === "repayment" ? all.filter(tx=>tx.type==="settlement") : all;
  if (filterPendingOnly) items=items.filter(tx=>tx.type!=="settlement" && (tx.isPending===true || tx.amount===null || tx.amount===undefined || tx.amount===""));
  if (!items.length) {
    stream.append(element("div","empty-chat",activeLedgerTab==="repayment"?"目前還沒有還款紀錄":filterPendingOnly?"目前沒有待補金額的紀錄":"目前沒有記帳紀錄，從下方輸入第一筆吧 ♡"));
    return;
  }
  // Show a compact audit timeline above the ledger, preserving the existing logs path.
  if (activeLedgerTab==="all" && !filterPendingOnly && logs.length) {
    const history=element("section","audit-timeline");
    logs.slice(0,6).forEach(log=>{
      const line=element("div","audit-entry");
      line.append(element("span","audit-icon","🖊️"));
      const detail=element("span","audit-copy",(log.actorName||log.operator||"使用者")+" "+(log.message||"更新紀錄"));
      line.append(detail);
      if(log.timeStr) line.append(element("span","audit-time","· "+log.timeStr));
      history.append(line);
    });
    stream.append(history);
  }
  let lastDate="";
  for(const tx of items){
    if(tx.date!==lastDate){
      lastDate=tx.date;
      const d=new Date((tx.date||"")+"T00:00:00+08:00");
      stream.append(element("div","date-divider",Number.isNaN(d.getTime())?tx.date:new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric"}).format(d)));
    }
    if(tx.type==="settlement"){
      const card=element("article","ledger-card repayment-card");
      const head=element("div","ledger-card-head");
      head.append(element("strong","","💸 "+tx.payer+" 還款給 "+(tx.receiver||(tx.payer==="Benson"?"佩筠":"Benson"))));
      head.append(element("strong","ledger-amount",money(tx.amount)));
      card.append(head,element("div","ledger-meta",(tx.date||"")+" · 還款紀錄"));
      const actions=element("div","ledger-actions");
      const del=element("button","ledger-action danger","撤銷");del.type="button";del.addEventListener("click",()=>deleteTx(tx.id));actions.append(del);card.append(actions);stream.append(card);continue;
    }
    const pending=tx.isPending===true||tx.amount===null||tx.amount===undefined||tx.amount==="";
    const card=element("article","ledger-card"+(pending?" pending-card":""));
    const head=element("div","ledger-card-head");
    head.append(element("strong","ledger-item",tx.item||"未命名項目"));
    head.append(element("strong","ledger-amount"+(pending?" pending-txt":""),pending?"⏳ 待補":money(tx.amount)));
    card.append(head);
    const meta=element("div","ledger-meta");
    meta.append(element("span","","🗓 "+(tx.date||"日期未設定")));
    meta.append(element("span","payer-tag",tx.payer+" 付"));
    meta.append(element("span","",tx.splitType==="split"?"兩人平分":(tx.payer==="Benson"?"佩筠":"Benson")+" 負擔"));
    if(tx.category) meta.append(element("span","",tx.category));
    card.append(meta);
    if(tx.updatedBy||tx.updatedAt) card.append(element("div","ledger-updated","🖊 "+(tx.updatedBy||tx.createdBy||tx.payer)+" 於 "+(tx.updatedAt?new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(tx.updatedAt)):"更新")+" "+(pending?"補上金額":"修改紀錄")));
    const actions=element("div","ledger-actions");
    const edit=element("button","ledger-action",pending?"補金額":"修改");edit.type="button";edit.addEventListener("click",()=>openEditModal(tx.id));
    const del=element("button","ledger-action danger","撤銷");del.type="button";del.addEventListener("click",()=>deleteTx(tx.id));
    actions.append(edit,del);card.append(actions);stream.append(card);
  }
}
window.setLedgerTab=(tab)=>{
  activeLedgerTab=tab;
  document.querySelectorAll(".ledger-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  if(tab==="details") $("balanceDetails").hidden=false;
  renderChat();
};
window.toggleSearch=()=>{$("searchPanel").hidden=!$("searchPanel").hidden;if(!$("searchPanel").hidden)$("searchInput").focus();};
window.shareLedger=async()=>{
  try{
    if(navigator.share) await navigator.share({title:"佩筠 × Benson 的小帳本",url:location.href});
    else if(navigator.clipboard){await navigator.clipboard.writeText(location.href);alert("帳本連結已複製");}
    else alert("請複製瀏覽器網址分享帳本");
  }catch(e){if(e.name!=="AbortError")alert("分享失敗，請直接複製網址");}
};
window.openSettings=()=>{
  if(!confirm("目前操作身分："+(currentMember||"未選擇")+"\n要切換操作身分嗎？")) return;
  currentMember=null;
  if(stopTransactions){stopTransactions();stopTransactions=null;}
  if(stopLogs){stopLogs();stopLogs=null;}
  $("chatApp").hidden=true;
  $("identityScreen").hidden=false;
};

window.toggleBalanceDetails=()=>{const el=$("balanceDetails");el.hidden=!el.hidden;document.querySelector(".balance-toggle").setAttribute("aria-expanded",String(!el.hidden));};
window.setSearch=(value)=>{searchTerm=value.trim();renderChat();};
window.toggleCalendar=()=>{const el=$("calendarPanel");el.hidden=!el.hidden;if(!el.hidden)renderCalendar();};
window.changeCalendarMonth=(delta)=>{calendarDate.setMonth(calendarDate.getMonth()+delta);renderCalendar();};
window.clearDateFilter=()=>{selectedDate="";selectedCalendarDate="";renderCalendar();renderChat();};
function renderCalendar(){
 const y=calendarDate.getFullYear(),m=calendarDate.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate();
 $("calendarTitle").textContent=`${y}年 ${m+1}月`;
 const grid=$("calendarGrid");grid.replaceChildren();
 ["日","一","二","三","四","五","六"].forEach(d=>grid.append(element("span","calendar-weekday",d)));
 const offset=first.getDay();for(let i=0;i<offset;i++)grid.append(element("span","calendar-empty",""));
 const byDate={};
 Object.values(transactions).forEach(tx=>{
   if(!tx||tx.isDeleted===true||!tx.date)return;
   const entry=byDate[tx.date]||(byDate[tx.date]={expense:false,repayment:false,pending:false});
   if(tx.type==="settlement")entry.repayment=true;
   else if(tx.isPending===true||tx.amount===null||tx.amount===undefined||tx.amount==="")entry.pending=true;
   else entry.expense=true;
 });
 for(let day=1;day<=days;day++){
   const key=`${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
   const b=element("button","calendar-day"+(selectedDate===key?" selected":""),String(day));b.type="button";
   const marks=byDate[key];
   if(marks){
     const dots=element("span","calendar-dots");
     if(marks.expense)dots.append(element("i","calendar-dot expense-dot"));
     if(marks.repayment)dots.append(element("i","calendar-dot repayment-dot"));
     if(marks.pending)dots.append(element("i","calendar-dot pending-dot"));
     b.append(dots);
   }
   b.addEventListener("click",()=>{selectedDate=key;selectedCalendarDate=key;renderCalendar();renderChat();renderCalendarDayModal(key);$("calendarDayModal").hidden=false;});
   grid.append(b);
 }
}
function renderCalendarDayModal(date){
 if(!date)return;
 const records=Object.entries(transactions).filter(([,tx])=>tx&&!tx.isDeleted&&tx.date===date).map(([id,tx])=>({id,...tx}));
 const expenseTotal=records.filter(tx=>tx.type!=="settlement"&&tx.isPending!==true&&tx.amount!==null&&tx.amount!==undefined&&tx.amount!=="").reduce((sum,tx)=>sum+Number(tx.amount||0),0);
 const repaymentTotal=records.filter(tx=>tx.type==="settlement").reduce((sum,tx)=>sum+Number(tx.amount||0),0);
 const pendingCount=records.filter(tx=>tx.type!=="settlement"&&(tx.isPending===true||tx.amount===null||tx.amount===undefined||tx.amount==="")).length;
 const d=new Date(date+"T00:00:00+08:00");
 $("calendarDayTitle").textContent=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"long",day:"numeric",weekday:"short"}).format(d);
 const summary=$("calendarDaySummary");summary.replaceChildren();
 [["支出總額",money(expenseTotal),"expense-summary"],["還款總額",money(repaymentTotal),"repayment-summary"]].forEach(([label,value,cls])=>{
   summary.append(element("div","calendar-summary-item "+cls,label+" "+value));
 });
 const list=$("calendarDayRecords");list.replaceChildren();
 if(!records.length){list.append(element("p","calendar-no-records","這一天還沒有帳務紀錄。"));return;}
 records.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
 records.forEach(tx=>{
   const isRepayment=tx.type==="settlement",pending=!isRepayment&&(tx.isPending===true||tx.amount===null||tx.amount===undefined||tx.amount==="");
   const row=element("button","calendar-record-row calendar-record-button"+(pending?" calendar-record-pending":""));
   row.type="button";
   const title=isRepayment?(tx.payer+" 還款給 "+(tx.receiver||(tx.payer==="Benson"?"佩筠":"Benson"))):(tx.item||"未命名項目");
   row.append(element("span","calendar-record-name",title),element("strong","calendar-record-value"+(pending?" pending-txt":""),pending?"待補 · 補金額":money(tx.amount)));
   row.title=pending?"點擊補上金額":isRepayment?"點擊修改還款紀錄":"點擊修改支出紀錄";
   row.addEventListener("click",()=>isRepayment?window.openEditSettlementModal(tx.id):window.openEditModal(tx.id));
   list.append(row);
 });
}
window.openCalendarDayModal=(date)=>{selectedCalendarDate=date||selectedCalendarDate;renderCalendarDayModal(selectedCalendarDate);$("calendarDayModal").hidden=false;};
window.openCalendarExpenseModal=()=>{
 if(!selectedCalendarDate)return;
 $("calendarExpenseDate").value=selectedCalendarDate;
 $("calendarExpenseInput").value="";
 $("calendarExpenseModal").classList.add("open");
 $("calendarExpenseInput").focus();
};
window.saveCalendarExpense=async(event)=>{
 event.preventDefault();
 if(!currentUser||!currentMember)return;
 const raw=$("calendarExpenseInput").value.trim(),date=$("calendarExpenseDate").value;
 if(!raw||!date)return alert("請輸入記帳內容及日期。");
 const parsed=parseNaturalLanguage(raw,currentMember,new Date());
 if(!parsed.ok)return alert(parsed.error||"無法辨識記帳內容。");
 if(parsed.transaction.type==="settlement")return alert("這裡是新增支出入口，還款請使用「新增還款」。");
 const now=new Date();
 const tx={...parsed.transaction,date,splitType:parsed.transaction.splitType||"split",
   shortTime:new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}).format(now),
   createdAt:Date.now(),createdByUid:currentUser.uid,createdBy:currentMember};
 try{
   await push(txRef,tx);
   await audit("create","月曆新增支出："+tx.item+(tx.isPending?"（待補）":" "+money(tx.amount))+"（"+tx.payer+" 付款）",null,tx);
   $("calendarExpenseModal").classList.remove("open");
   selectedCalendarDate=date;selectedDate=date;renderCalendar();renderChat();renderCalendarDayModal(date);$("calendarDayModal").hidden=false;
 }catch(error){alert("新增支出失敗，請確認網路連線及 Firebase 權限。");}
};
window.openCalendarRepaymentModal=()=>{
 if(!selectedCalendarDate)return;
 window.openSettleModal();
 if($("settleModal").classList.contains("open"))$("settleDate").value=selectedCalendarDate;
};
window.openCalculator=()=>{$("calculatorModal").classList.add("open");};
window.calcPress=(key)=>{if(key==="C")calcExpression="";else if(key==="="){try{const safe=calcExpression.replace(/×/g,"*").replace(/÷/g,"/").replace(/−/g,"-");if(!/^[0-9+*/.() -]+$/.test(safe))throw Error();calcExpression=String(Function('"use strict";return ('+safe+')')());}catch{calcExpression="錯誤";}}else calcExpression+=key;$("calcDisplay").value=calcExpression||"0";};

window.openPendingModal=()=>{
 const pending=Object.entries(transactions)
   .filter(([,tx])=>tx&&!tx.isDeleted&&tx.type!=="settlement"&&(tx.isPending===true||tx.amount===null||tx.amount===undefined||tx.amount===""))
   .map(([id,tx])=>({id,...tx}))
   .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||(b.createdAt||0)-(a.createdAt||0));
 const list=$("pendingList");list.replaceChildren();
 if(!pending.length)list.append(element("p","calendar-no-records","目前沒有待補金額的紀錄。"));
 pending.forEach(tx=>{
   const button=element("button","calendar-pending-choice");
   button.type="button";
   button.append(element("strong","",tx.item||"未命名項目"));
   button.append(element("span","",(tx.date||"日期未設定")+" · "+(tx.payer||"未指定付款人")+" 付款 · 金額待補"));
   button.addEventListener("click",()=>{$("pendingModal").classList.remove("open");window.openEditModal(tx.id);});
   list.append(button);
 });
 $("pendingModal").classList.add("open");
};
window.togglePendingFilter = () => {
  filterPendingOnly=!filterPendingOnly; $("pendingFilterBtn").classList.toggle("active",filterPendingOnly); renderChat();
};
window.sendQuickTx = async (event) => {
  event.preventDefault();
  if (!currentUser || !currentMember) return;
  const raw = $("quickItem").value.trim();
  if (!raw) return;
  const now = new Date();
  const parsed = parseNaturalLanguage(raw, currentMember, now);
  if (!parsed.ok) return alert(parsed.error || "無法辨識記帳內容，請確認項目、金額及付款人。");
  const tx = {
    ...parsed.transaction,
    splitType: parsed.transaction.splitType || "split",
    shortTime: new Intl.DateTimeFormat("zh-TW", {timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}).format(now),
    createdAt: Date.now(), createdByUid: currentUser.uid, createdBy: currentMember
  };
  try {
    await push(txRef, tx);
    await audit("create", "新增：" + tx.item + (tx.isPending ? "（待補）" : " " + money(tx.amount)) + "（" + tx.payer + " 付款）", null, tx);
    $("quickItem").value = "";
    $("quickItem").focus();
  } catch (e) {
    alert("新增失敗，請確認網路連線及 Firebase 資料庫權限。");
  }
};
window.openEditModal = (id) => {
  const tx=transactions[id]; if(!tx || tx.isDeleted) return;
  $("editTxId").value=id;$("editModalTitle").textContent=tx.isPending?"💰 補上消費金額":"✏️ 修改這筆消費";
  const pending = tx.isPending === true || tx.amount === null || tx.amount === undefined || tx.amount === "";
  $("editItem").value=tx.item||"";$("editAmount").value=pending?"":tx.amount;
  // 從待補清單進入時，直接提供可輸入的金額欄位。
  $("editPending").checked=false;$("editAmount").disabled=false;$("editDate").value=tx.date||taiwanDateString();
window.selectRadio("editPayerGroup",tx.payer);window.selectRadio("editSplitGroup",tx.splitType||"split");
  $("editModal").classList.add("open");
};
window.toggleEditPending=()=>{const p=$("editPending").checked;$("editAmount").disabled=p;if(p)$("editAmount").value="";};
window.saveEditedTx=async(event)=>{
  event.preventDefault();const id=$("editTxId").value,old=transactions[id];if(!old||old.isDeleted)return;
  const amountValue=$("editAmount").value.trim();const pending=$("editPending").checked||amountValue==="";const amount=pending?0:Number(amountValue);
  const after={item:$("editItem").value.trim(),amount,isPending:pending,payer:getRadioVal("editPayerGroup"),splitType:getRadioVal("editSplitGroup"),date:$("editDate").value};
  if(!after.item||(!pending&&(!Number.isSafeInteger(amount)||amount<=0))||!after.date||!["Benson","佩筠"].includes(after.payer)||!["split","advance"].includes(after.splitType))return alert("請確認項目、日期、付款人及正整數金額。");
  try{await update(ref(db,"transactions/"+id),{...after,updatedAt:Date.now(),updatedByUid:currentUser.uid,updatedBy:currentMember});await audit("update","修改："+old.item+" → "+after.item,old,after);window.closeModals();}
  catch(e){alert("修改失敗，請確認資料庫權限。");}
};
window.openSettleModal=()=>{
  $("settleTxId").value="";
  const s=describeSettlement(netBalance);if(!s.amount)return alert("目前沒有待結清款項。");
  $("settleAmount").value=s.amount;window.selectRadio("settleDirGroup",s.debtor+"->"+s.creditor);$("settleDate").value=taiwanDateString();
  $("settleModal").querySelector(".modal-title").textContent="💸 記錄一筆還款";
  $("settleModal").querySelector(".btn-submit").textContent="送出還款訊息";
  $("settleModal").classList.add("open");
};
window.openEditSettlementModal=(id)=>{
  const tx=transactions[id];if(!tx||tx.isDeleted||tx.type!=="settlement")return;
  const receiver=tx.receiver||(tx.payer==="Benson"?"佩筠":"Benson");
  $("settleTxId").value=id;
  window.selectRadio("settleDirGroup",tx.payer+"->"+receiver);
  $("settleAmount").value=tx.amount;
  $("settleDate").value=tx.date||taiwanDateString();
  $("settleModal").querySelector(".modal-title").textContent="✏️ 修改還款紀錄";
  $("settleModal").querySelector(".btn-submit").textContent="儲存還款修改";
  $("settleModal").classList.add("open");
};
window.saveSettlement=async(event)=>{
  event.preventDefault();
  const id=$("settleTxId").value;
  const [payer,receiver]=getRadioVal("settleDirGroup").split("->"),amount=Number($("settleAmount").value);
  const date=$("settleDate").value||taiwanDateString();
  if(!["Benson","佩筠"].includes(payer)||!["Benson","佩筠"].includes(receiver)||payer===receiver||!Number.isSafeInteger(amount)||amount<=0||!date)
    return alert("請確認還款人、收款人、日期及正整數金額。");
  const tx={type:"settlement",payer,receiver,amount,date,isPending:false};
  try{
    if(id){
      const old=transactions[id];if(!old||old.isDeleted)return;
      const after={...tx,updatedAt:Date.now(),updatedByUid:currentUser.uid,updatedBy:currentMember};
      await update(ref(db,"transactions/"+id),after);
      await audit("update","修改還款："+payer+" 還給 "+receiver+" "+money(amount),old,after);
    }else{
      const err=validateSettlement({payer,receiver,amount},netBalance);if(err)return alert(err);
      const created={...tx,createdAt:Date.now(),createdByUid:currentUser.uid,createdBy:currentMember};
      await push(txRef,created);await audit("settlement","還款："+payer+" 還給 "+receiver+" "+money(amount),null,created);
    }
    window.closeModals();
    $("settleTxId").value="";
    $("settleModal").querySelector(".modal-title").textContent="💸 記錄一筆還款";
    $("settleModal").querySelector(".btn-submit").textContent="送出還款訊息";
    if(selectedCalendarDate){renderCalendarDayModal(selectedCalendarDate);$("calendarDayModal").hidden=false;}
  }catch(e){alert(id?"修改還款紀錄失敗。":"還款紀錄新增失敗。");}
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
