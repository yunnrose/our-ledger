/**
 * Our Ledger v1.1 — pure ledger domain functions.
 * Currency is integer TWD. No Firebase or DOM dependency.
 */
export const MEMBERS = Object.freeze(["佩筠", "Benson"]);
export const DEFAULT_SPLIT = "split";

export function taiwanDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

export function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days, 12));
  return date.toISOString().slice(0, 10);
}

export function toTwdInteger(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("金額必須是大於或等於 0 的有效數字");
  }
  return Math.round(amount);
}

/**
 * Net balance convention:
 *   positive => 佩筠 owes Benson
 *   negative => Benson owes 佩筠
 */
export function calculateLedger(transactions = {}, now = new Date()) {
  const month = taiwanDateString(now).slice(0, 7);
  const result = {
    netBalance: 0,
    totalExpense: 0,
    monthlyExpense: 0,
    paid: { 佩筠: 0, Benson: 0 },
    share: { 佩筠: 0, Benson: 0 },
    pendingCount: 0,
    pendingAmountCount: 0,
    validExpenseCount: 0,
    settlements: 0
  };

  for (const tx of Object.values(transactions || {})) {
    if (!tx || typeof tx !== "object" || tx.isDeleted === true) continue;
    if (tx.isPending) {
      result.pendingCount += 1;
      continue;
    }
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount < 0) continue;

    if (tx.type === "settlement") {
      const receiver = tx.receiver || (tx.payer === "Benson" ? "佩筠" : "Benson");
      if (!MEMBERS.includes(tx.payer) || !MEMBERS.includes(receiver) ||
          tx.payer === receiver || amount <= 0) continue;
      // Legacy rows omit receiver; infer the historical opposite member.
      result.netBalance += tx.payer === "Benson" ? amount : -amount;
      result.settlements += amount;
      continue;
    }

    if (tx.type && tx.type !== "expense") continue;
    if (!MEMBERS.includes(tx.payer) || amount <= 0) continue;

    result.validExpenseCount += 1;
    result.totalExpense += amount;
    result.paid[tx.payer] += amount;
    if (String(tx.date || "").startsWith(month)) result.monthlyExpense += amount;

    const splitType = tx.splitType || DEFAULT_SPLIT;
    const payerShare = splitType === "advance" ? 0 : Math.floor(amount / 2);
    const otherShare = splitType === "advance" ? amount : amount - payerShare;
    result.share[tx.payer] += payerShare;
    const other = tx.payer === "Benson" ? "佩筠" : "Benson";
    result.share[other] += otherShare;

    // Only the amount paid on behalf of the other member affects settlement.
    result.netBalance += tx.payer === "Benson" ? otherShare : -otherShare;
  }

  result.netBalance = Math.round(result.netBalance);
  result.totalExpense = Math.round(result.totalExpense);
  result.monthlyExpense = Math.round(result.monthlyExpense);
  return result;
}

export function describeSettlement(netBalance) {
  if (netBalance === 0) return { debtor: null, creditor: null, amount: 0, label: "目前完全結清" };
  return netBalance > 0
    ? { debtor: "佩筠", creditor: "Benson", amount: netBalance, label: "佩筠應付給 Benson" }
    : { debtor: "Benson", creditor: "佩筠", amount: Math.abs(netBalance), label: "Benson 應付給佩筠" };
}

export function parseNaturalLanguage(input, operator, now = new Date()) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "請輸入記帳內容" };
  if (!MEMBERS.includes(operator)) return { ok: false, error: "請先確認目前登入身分" };

  let date = taiwanDateString(now);
  let text = raw;
  if (/前天/.test(text)) { date = addDays(date, -2); text = text.replace("前天", ""); }
  else if (/昨天|昨日/.test(text)) { date = addDays(date, -1); text = text.replace(/昨天|昨日/, ""); }
  else if (/今天|今日/.test(text)) { text = text.replace(/今天|今日/, ""); }

  const explicitDate = text.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/);
  if (explicitDate) {
    const y = Number(explicitDate[1]), m = Number(explicitDate[2]), d = Number(explicitDate[3]);
    const candidate = new Date(Date.UTC(y, m - 1, d, 12));
    if (candidate.getUTCFullYear() !== y || candidate.getUTCMonth() !== m - 1 || candidate.getUTCDate() !== d)
      return { ok: false, error: "日期格式不正確" };
    date = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    text = text.replace(explicitDate[0], "");
  }

  const pending = /待補|金額未定|還沒確認金額/.test(text);
  const splitType = /對方全額負擔|對方負擔全部|對方付全額/.test(text) ? "advance" : "split";
  const payerMatch = text.match(/(Benson|佩筠)\s*(?:付|付款|先付)/i);
  const payer = /我付|我付款|我先付/.test(text) ? operator : payerMatch ? payerMatch[1] : null;

  const amountMatch = text.match(/(?:NT\$?\s*)?([0-9][0-9,]*(?:\.\d+)?)\s*(?:元|塊)?/);
  const amount = pending ? 0 : amountMatch ? Math.round(Number(amountMatch[1].replace(/,/g, ""))) : null;
  if (!pending && (amount === null || !Number.isSafeInteger(amount) || amount <= 0))
    return { ok: false, error: "尚未辨識到有效金額，請補上金額或標記「待補」" };
  if (!payer) return { ok: false, error: "尚未辨識付款人，請加上「Benson 付」、「佩筠 付」或「我付」" };

  let item = text
    .replace(/Benson|佩筠/g, "")
    .replace(/我付|我付款|我先付|付錢|付款|先付|付/g, "")
    .replace(/對方全額負擔|對方負擔全部|對方付全額|兩人平分|平分|待補|金額未定|還沒確認金額/g, "")
    .replace(/(?:NT\$?\s*)?[0-9][0-9,]*(?:\.\d+)?\s*(?:元|塊)?/g, "")
    .replace(/[，,。\s]/g, " ")
    .trim();
  item = item.replace(/\s+/g, " ").replace(/^(的)+|的+$/g, "").trim();
  if (!item) return { ok: false, error: "尚未辨識到消費項目" };

  return {
    ok: true,
    transaction: {
      type: "expense", item, amount, isPending: pending, payer, splitType, date,
      createdAt: Date.now(), sourceText: raw
    }
  };
}

export function validateSettlement({ payer, receiver, amount }, netBalance) {
  if (!MEMBERS.includes(payer) || !MEMBERS.includes(receiver) || payer === receiver)
    return "請選擇正確的付款人及收款人";
  if (!Number.isSafeInteger(amount) || amount <= 0) return "還款金額必須是正整數";
  const expectedPayer = netBalance > 0 ? "佩筠" : netBalance < 0 ? "Benson" : null;
  if (!expectedPayer) return "目前沒有待結清的款項";
  if (payer !== expectedPayer) return `目前應由${expectedPayer}還款`;
  if (amount > Math.abs(netBalance)) return "還款金額不可超過目前未結清金額";
  return null;
}
