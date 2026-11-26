import * as firebaseWebConfig from "../js/firebase-config.js";\nconst firebaseConfig = firebaseWebConfig.firebaseConfig;\nconst appCheckSiteKey = firebaseWebConfig.appCheckSiteKey || "";\nif (!firebaseConfig) throw new Error("Firebase 設定缺少 firebaseConfig 匯出。");
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
    if(tx.type==="expense" && tx.status==="pending"){pending++;continue;}
    if(tx.type==="expense" && tx.status==="confirmed"){
      const amount=Number(tx.amount);
      if(!Number.isSafeInteger(amount)||amount<=0) continue;
      if(String(tx.date||"").startsWith(currentMonth)) month+=amount;
      const own=Number(tx.shares?.[tx.payer]||0);
      net += tx.payer==="peijun" ? amount-own : -(amount-own);
    } else if(tx.type==="repayment" && tx.status==="confirmed"){
      const amount=Number(tx.amount);
      if(!Number.isSafeInteger(amount)||amount<=0) continue;
      // Benson repaying Peijun reduces a positive balance; Peijun repaying Benson reduces a negative balance.
      net += tx.payer==="benson" ? -amount : amount;
    }
  }
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
    if(tx.type==="expense"){
      const actions=document.createElement("div");actions.className="record-actions";
      if(tx.status==="pending"){const confirm=document.createElement("button");confirm.textContent="補上金額";confirm.onclick=()=>completePending(id,tx);actions.append(confirm);}
      const voidBtn=document.createElement("button");voidBtn.textContent="作廢";voidBtn.onclick=()=>voidRecord(id,tx);actions.append(voidBtn);row.append(actions);
    }
    root.append(row);
  }
}
