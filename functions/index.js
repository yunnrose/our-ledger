const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { createHash } = require("node:crypto");

initializeApp();
const REGION = "asia-southeast1";
const ROOT = "ourLittleLedger";
const MEMBERS = Object.freeze({
  peijun: { uid: "ourledger_peijun", displayName: "佩筠" },
  benson: { uid: "ourledger_benson", displayName: "Benson" }
});

function digest(code) {
  return createHash("sha256").update(String(code).trim(), "utf8").digest("hex");
}

/**
 * One-time invitation redemption.
 * Only a SHA-256 digest is stored in RTDB. The raw code is never stored.
 * The transaction atomically consumes the invitation before issuing a custom token.
 */
exports.redeemInvitation = onCall({ region: REGION, enforceAppCheck: true }, async (request) => {
  const code = typeof request.data?.code === "string" ? request.data.code.trim() : "";
  if (code.length < 12 || code.length > 128) {
    throw new HttpsError("invalid-argument", "邀請碼格式不正確。");
  }

  const hash = digest(code);
  const inviteRef = getDatabase().ref(`${ROOT}/invitations/${hash}`);
  let redeemed;
  const result = await inviteRef.transaction((invite) => {
    if (!invite || invite.usedAt || !invite.member || !MEMBERS[invite.member]) return;
    if (!Number.isFinite(invite.expiresAt) || invite.expiresAt <= Date.now()) return;
    redeemed = { ...invite, usedAt: Date.now() };
    return redeemed;
  }, undefined, false);

  if (!result.committed || !redeemed) {
    throw new HttpsError("permission-denied", "邀請碼無效、已使用或已過期。");
  }

  const member = MEMBERS[redeemed.member];
  const uidRef = getDatabase().ref(`${ROOT}/memberUids/${redeemed.member}`);
  const uidResult = await uidRef.transaction((current) => current || member.uid, undefined, false);
  if (!uidResult.committed || uidResult.snapshot.val() !== member.uid) {
    throw new HttpsError("failed-precondition", "成員身分設定不一致，請聯絡管理者。");
  }

  const customToken = await getAuth().createCustomToken(member.uid, {
    member: redeemed.member,
    displayName: member.displayName,
    app: "ourLittleLedger"
  });
  return { customToken, member: redeemed.member, displayName: member.displayName };
});
