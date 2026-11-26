import { test } from "node:test";
import assert from "node:assert/strict";
import { accountsToRestore, usableAccount } from "../../src/shared/saved-accounts.ts";

const withToken = { id: "a", token: "secret" };
const listed = { id: "a", token: "" };

test("the secrets copy wins and is kept", () => {
  assert.deepEqual(accountsToRestore(JSON.stringify([withToken]), [listed]), { accounts: [withToken], persist: true });
});

test("a failed secrets read never writes the token-less list over the real tokens", () => {
  assert.deepEqual(accountsToRestore(null, [listed]), { accounts: [listed], persist: false });
  assert.deepEqual(accountsToRestore("not json", [listed]), { accounts: [listed], persist: false });
});

test("an install from before the secrets store moves its tokens there", () => {
  assert.deepEqual(accountsToRestore(null, [withToken]), { accounts: [withToken], persist: true });
});

test("only accounts with a token and no pending sign-in connect", () => {
  assert.equal(usableAccount(withToken), true);
  assert.equal(usableAccount(listed), false);
  assert.equal(usableAccount({ token: "", pending: "offline" }), false);
  assert.equal(usableAccount({ token: "x", pending: "invalid" }), false);
});
