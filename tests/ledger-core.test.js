import test from "node:test";
import assert from "node:assert/strict";
import { calculateLedger, describeSettlement, parseNaturalLanguage, taiwanDateString, validateSettlement } from "../js/ledger-core.js";

test("平分消費：Benson 付 1000、佩筠付 600，佩筠欠 Benson 200", () => {
  const r = calculateLedger({
    a: { type:"expense", amount:1000, payer:"Benson", splitType:"split", date:"2026-11-25" },
    b: { type:"expense", amount:600, payer:"佩筠", splitType:"split", date:"2026-11-25" }
  }, new Date("2026-11-25T04:00:00Z"));
  assert.equal(r.netBalance, 200);
  assert.equal(r.totalExpense, 1600);
  assert.deepEqual(describeSettlement(r.netBalance), { debtor:"佩筠", creditor:"Benson", amount:200, label:"佩筠應付給 Benson" });
});

test("對方全額負擔：Benson 墊付 300，佩筠欠 300", () => {
  const r = calculateLedger({ a:{ type:"expense", amount:300, payer:"Benson", splitType:"advance", date:"2026-11-25" } });
  assert.equal(r.netBalance, 300);
});

test("待補不納入支出及結算", () => {
  const r = calculateLedger({ a:{ type:"expense", amount:0, isPending:true, payer:"Benson" } });
  assert.equal(r.pendingCount, 1);
  assert.equal(r.totalExpense, 0);
  assert.equal(r.netBalance, 0);
});

test("還款方向抵銷欠款", () => {
  const r = calculateLedger({
    a:{ type:"expense", amount:1000, payer:"Benson", splitType:"split", date:"2026-11-25" },
    b:{ type:"settlement", amount:300, payer:"佩筠", receiver:"Benson", date:"2026-11-25" }
  });
  assert.equal(r.netBalance, 200);
});

test("自然語言辨識今天早餐與我付", () => {
  const r = parseNaturalLanguage("今天早餐 120 我付", "佩筠", new Date("2026-11-25T04:00:00Z"));
  assert.equal(r.ok, true);
  assert.equal(r.transaction.item, "早餐");
  assert.equal(r.transaction.amount, 120);
  assert.equal(r.transaction.payer, "佩筠");
  assert.equal(r.transaction.date, "2026-11-25");
});

test("自然語言辨識待補", () => {
  const r = parseNaturalLanguage("屈臣氏 Benson 付，金額待補", "佩筠");
  assert.equal(r.ok, true);
  assert.equal(r.transaction.isPending, true);
  assert.equal(r.transaction.item, "屈臣氏");
});

test("還款不能超過餘額", () => {
  assert.match(validateSettlement({payer:"佩筠",receiver:"Benson",amount:301}, 300), /超過/);
});

test("舊版還款紀錄沒有 receiver 時仍可正確結算", () => {
  const r = calculateLedger({
    a:{ type:"expense", amount:1000, payer:"Benson", splitType:"split", date:"2026-11-25" },
    b:{ type:"settlement", amount:300, payer:"佩筠", date:"2026-11-25" }
  });
  assert.equal(r.netBalance, 200);
});

test("撤銷紀錄保留在資料中但不參與結算", () => {
  const r = calculateLedger({
    a:{ type:"expense", amount:1000, payer:"Benson", splitType:"split", date:"2026-11-25", isDeleted:true }
  });
  assert.equal(r.netBalance, 0);
  assert.equal(r.totalExpense, 0);
});


test("自然語言辨識晚餐 850 Benson 付，預設平分", () => {
  const r = parseNaturalLanguage("晚餐 850 Benson 付", "佩筠", new Date("2026-11-25T04:00:00Z"));
  assert.equal(r.ok, true);
  assert.equal(r.transaction.item, "晚餐");
  assert.equal(r.transaction.amount, 850);
  assert.equal(r.transaction.payer, "Benson");
  assert.equal(r.transaction.splitType, "split");
});

test("自然語言辨識昨天咖啡 90 Benson 付", () => {
  const r = parseNaturalLanguage("昨天咖啡 90 Benson 付", "佩筠", new Date("2026-11-25T04:00:00Z"));
  assert.equal(r.ok, true);
  assert.equal(r.transaction.item, "咖啡");
  assert.equal(r.transaction.amount, 90);
  assert.equal(r.transaction.payer, "Benson");
  assert.equal(r.transaction.date, "2026-11-24");
});

test("缺少付款人時預設目前操作身分", () => {
  const r=parseNaturalLanguage("超商 120","佩筠",new Date("2026-11-25T04:00:00Z"));
  assert.equal(r.ok,true); assert.equal(r.transaction.payer,"佩筠"); assert.equal(r.transaction.item,"超商");
});
test("辨識月日日期與對方全額負擔", () => {
  const r=parseNaturalLanguage("11/25 晚餐 850 Benson付 全算對方的","佩筠",new Date("2026-11-25T04:00:00Z"));
  assert.equal(r.ok,true); assert.equal(r.transaction.date,"2026-11-25"); assert.equal(r.transaction.splitType,"advance");
});
test("辨識雙方還款自然語言", () => {
  const r=parseNaturalLanguage("Benson 還給 佩筠 500","Benson",new Date("2026-11-25T04:00:00Z"));
  assert.equal(r.ok,true); assert.equal(r.transaction.type,"settlement"); assert.equal(r.transaction.payer,"Benson"); assert.equal(r.transaction.receiver,"佩筠"); assert.equal(r.transaction.amount,500);
});
