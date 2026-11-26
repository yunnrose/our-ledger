import { firebaseConfig, appCheckSiteKey } from "../js/firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { getAuth, signInWithCustomToken, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, onValue, push, set, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

const $ = id => document.getElementById(id);
const money = n => "NT$ " + Math.round(Number(n)||0).toLocaleString("zh-TW");
const today = () => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());
const memberName = key => key === "peijun" ? "佩筠" : "Benson";
const app = initializeApp(firebaseConfig);
if (appCheckSiteKey) initializeAppCheck(app,{provider:new ReCaptchaV3Provider(appCheckSiteKey),isTokenAutoRefreshEnabled:true});
const auth = getAuth(app), db = getDatabase(app), functions = getFunctions(app,"asia-southeast1");
const redeemInvitation = httpsCallable(functions,"redeemInvitation");
let currentMember = null, transactions = {}, unsubscribe = null;

$("todayLabel").textContent = new Intl.DateTimeFormat("zh-TW",{month:"numeric",day:"numeric",weekday:"short",timeZone:"Asia/Taipei"}).format(new Date());
$("expenseDate").value = today(); $("repayDate").value = today();

function setStatus(el, message){ if(el) el.textContent=message; }
function compute(){
  let net=0, month=0, pending=0;
  const currentMonth=today().slice(0,7);
  for(const tx of Object.values(transactions)){
    if(!tx || tx.status==="voided") continue;
    if(tx.type==="expense"){
      if(tx.status==="pending" || tx.amount==null){pending++;continue;}
      const amount=Number(tx.amount); if(!Number.isSafeInteger(amount)||amount<=0) continue;
      if(String(tx.date||"").startsWith(currentMonth)) month+=amount;
      const shares=tx.shares||{};
      net += Number(shares.benson||0) - (tx.payer==="benson"?amount:0);
      // Positive net means Benson owes Peijun; expenses paid by Peijun for Benson increase it.
      net = net; 
      const peijunShare=Number(shares.peijun||0), bensonShare=Number(shares.benson||0);
      net = (tx.payer==="peijun" ? amount-peijunShare : - (amount-bensonShare));
    }
  }
  // Recalculate using payer's out-of-pocket minus own share; repayments reduce the creditor's balance.
  net=0;
  for(const tx of Object.values(transactions)){
    if(!tx || tx.status==="voided") continue;
    if(tx.type==="expense" && tx.status==="confirmed"){
      const own=Number(tx.shares?.[tx.payer]||0);
      net += tx.payer==="peijun" ? Number(tx.amount)-own : -(Number(tx.amount)-own);
    } else if(tx.type==="repayment" && tx.status==="confirmed"){
      net += tx.payer==="benson" ? Number(tx.amount) : -Number(tx.amount);
    } else if(tx.type==="expense" && tx.status==="pending") pending++;
  }
  const total = Object.values(transactions).filter(x=>x?.type==="expense"&&x.status==="confirmed").reduce((s,x)=>s+Number(x.amount||0),0);
  $("balanceValue").textContent=money(Math.abs(net));
  $("balanceCaption").textContent=net>0?"Benson 應付給佩筠":net<0?"佩筠應付給 Benson":"目前帳目已平衡 ♡";
  $("monthTotal").textContent=money(month); $("pendingTotal").textContent=pending+" 筆";
  const list=Object.entries(transactions).filter(([,x])=>x&&x.status!=="voided").sort((a,b)=>(b[1].date||"").localeCompare(a[1].date||"")).slice(0,8);
  const root=$("recentRecords"); root.className="records";
  if(!list.length){root.className="records empty-state";root.innerHTML='<div class="empty-heart">♡</div><strong>第一筆共同回憶，從今天開始</strong><p>新增一筆支出，讓你們的小帳本慢慢累積。</p>';return;}
  root.innerHTML="";
  for(const [id,tx] of list){
    const row=document.createElement("article");row.className="record-row";
    const title=document.createElement("strong");title.textContent=tx.title|| (tx.type==="repayment"?"還款":"未命名支出");
    const meta=document.createElement("span");meta.textContent=(tx.date||"")+" · "+(tx.type==="repayment"?"還款":memberName(tx.payer)+" 付款")+" · "+(tx.status==="pending"?"待補":"已確認");
    const amount=document.createElement("b");amount.textContent=tx.amount?money(tx.amount):"待補金額";
    row.append(title,meta,amount);
    if(tx.type==="expense" && tx.status!=="voided"){
      const actions=document.createElement("div");actions.className="record-actions";
      if(tx.status==="pending"){const confirm=document.createElement("button");confirm.textContent="補上金額";confirm.onclick=()=>completePending(id,tx);actions.append(confirm);}
      const voidBtn=document.createElement("button");voidBtn.textContent="作廢";voidBtn.onclick=()=>voidRecord(id,tx);actions.append(voidBtn);row.append(actions);
    }
    root.append(row);
  }
}
function subscribe(uid){
  if(unsubscribe) unsubscribe();
  const dataRef=ref(db,"ourLittleLedger/transactions");
  unsubscribe=onValue(dataRef,s=>{transactions=s.val()||{};compute();},err=>setStatus($("loginHint"),"讀取雲端資料失敗："+err.message));
}
function sharesFor(amount,payer,split){
  const other=payer==="peijun"?"benson":"peijun";
  if(split==="peijun") return {peijun:amount,benson:0};
  if(split==="benson") return {peijun:0,benson:amount};
  const payerShare=Math.ceil(amount/2),otherShare=amount-payerShare;
  return {[payer]:payerShare,[other]:otherShare};
}
async function saveExpense(e){
  e.preventDefault(); const title=$("expenseTitle").value.trim(), raw=$("expenseAmount").value;
  const amount=raw===""?null:Number(raw),payer=$("expensePayer").value,split=$("expenseSplit").value;
  if(!title){alert("請輸入項目名稱");return;}
  if(amount!==null&&(!Number.isSafeInteger(amount)||amount<=0)){alert("金額必須是大於 0 的整數");return;}
  const data={type:"expense",title,amount,payer,shares:amount===null?null:sharesFor(amount,payer,split),split,date:$("expenseDate").value,category:$("expenseCategory").value,note:$("expenseNote").value.trim(),status:amount===null?"pending":"confirmed",createdBy:currentMember,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  try{const node=push(ref(db,"ourLittleLedger/transactions"));await set(node,data);$("expenseDialog").close();$("expenseForm").reset();$("expenseDate").value=today();}catch(err){alert("儲存失敗，請確認網路與登入狀態："+err.message);}
}
async function saveRepayment(e){
  e.preventDefault();const payer=$("repayPayer").value,receiver=$("repayReceiver").value,amount=Number($("repayAmount").value);
  if(payer===receiver||!Number.isSafeInteger(amount)||amount<=0){alert("請確認還款人、收款人及正整數金額");return;}
  const data={type:"repayment",title:memberName(payer)+" 還款給 "+memberName(receiver),payer,receiver,amount,date:$("repayDate").value,status:"confirmed",createdBy:currentMember,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  try{await set(push(ref(db,"ourLittleLedger/transactions")),data);$("repaymentDialog").close();$("repaymentForm").reset();$("repayDate").value=today();}catch(err){alert("還款儲存失敗："+err.message);}
}
async function completePending(id,tx){
  const value=prompt("請輸入實際金額（NT$）");if(value===null)return;const amount=Number(value);
  if(!Number.isSafeInteger(amount)||amount<=0){alert("金額必須是大於 0 的整數");return;}
  const split=tx.split||"equal";await update(ref(db,"ourLittleLedger/transactions/"+id),{amount,shares:sharesFor(amount,tx.payer,split),status:"confirmed",updatedAt:serverTimestamp(),updatedBy:currentMember});
}
async function voidRecord(id,tx){
  const reason=prompt("請填寫作廢原因（必填）");if(!reason?.trim())return;
  if(!confirm("確定作廢這筆紀錄？紀錄會保留在稽核資料中，不會被刪除。"))return;
  const patch={status:"voided",voidReason:reason.trim(),voidedBy:currentMember,voidedAt:Date.now(),updatedAt:serverTimestamp()};
  try{await update(ref(db,"ourLittleLedger/transactions/"+id),patch);await set(push(ref(db,"ourLittleLedger/auditLogs")),{action:"void",recordId:id,before:tx,after:{...tx,...patch},actor:currentMember,at:Date.now()});}catch(err){alert("作廢失敗："+err.message);}
}
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();const code=$("inviteCode").value.trim();$("loginButton").disabled=true;setStatus($("loginHint"),"正在驗證邀請碼…");
  try{if(!appCheckSiteKey)throw new Error("尚未設定 App Check site key，請先完成 Firebase 安全設定。");const result=await redeemInvitation({code});await signInWithCustomToken(auth,result.data.customToken);$("inviteCode").value="";}
  catch(err){setStatus($("loginHint"),err.message||"登入失敗，請確認邀請碼。");}
  finally{$("loginButton").disabled=false;}
});
onAuthStateChanged(auth,user=>{
  $("loginPanel").hidden=!!user;$("ledgerPanel").hidden=!user;$("bottomNav").hidden=!user;
  if(user){currentMember=user.getIdTokenResult?null:null;user.getIdTokenResult().then(t=>{currentMember=t.claims.member; $("signedInAs").textContent="已登入："+memberName(currentMember)+" · 雲端同步中";subscribe(user.uid);});}
  else{currentMember=null;if(unsubscribe)unsubscribe();transactions={};}
});
$("expenseForm").addEventListener("submit",saveExpense);$("repaymentForm").addEventListener("submit",saveRepayment);
$("addExpense").addEventListener("click",()=>{if(!currentMember)return;$("expensePayer").value=currentMember;$("expenseDialog").showModal();});
$("repaymentBtn").addEventListener("click",()=>{$("repayPayer").value=currentMember;$("repayReceiver").value=currentMember==="peijun"?"benson":"peijun";$("repaymentDialog").showModal();});
$("signOutBtn").addEventListener("click",()=>signOut(auth));
$("allRecords").addEventListener("click",()=>alert("目前首頁顯示最近 8 筆紀錄；完整明細篩選功能仍在開發中。"));
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));b.classList.add("active");if(b.dataset.view!=="home")alert("此頁面尚在開發中。");}));
$("settingsBtn").addEventListener("click",()=>alert("資料直接儲存在 Firebase 雲端。請勿分享邀請碼。"));
function download(name,type,content){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
$("exportJsonBtn").addEventListener("click",()=>download("our-little-ledger-backup-"+today()+".json","application/json",JSON.stringify({exportedAt:new Date().toISOString(),transactions},null,2)));
$("exportCsvBtn").addEventListener("click",()=>{const rows=[["日期","類型","項目","金額","付款人","狀態","分類","備註"],...Object.values(transactions).map(x=>[x.date,x.type,x.title,x.amount??"",x.payer,x.status,x.category||"",x.note||""])];const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n");download("our-little-ledger-"+today()+".csv","text/csv;charset=utf-8",csv);});
