import assert from "node:assert/strict";
import test from "node:test";
import { clearSessionCookie, hashPassword, hashToken, randomToken, readCookie, sessionCookie, verifyPassword } from "./security.js";

test("random tokens are URL safe and have sufficient entropy", () => {
  const token = randomToken(32);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length >= 40);
});

test("token hashes are deterministic and do not equal the source token", () => {
  const token = randomToken();
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), token);
  assert.match(hashToken(token), /^[a-f0-9]{64}$/);
});

test("password hashes verify and reject incorrect passwords", async () => {
  const encoded = await hashPassword("a-long-and-unique-password");
  assert.notEqual(encoded, "a-long-and-unique-password");
  assert.equal(await verifyPassword("a-long-and-unique-password", encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
});

test("cookie parsing handles encoded values", () => {
  assert.equal(readCookie("theme=dark; fd_session=abc%2B123; other=x", "fd_session"), "abc+123");
  assert.equal(readCookie(undefined, "fd_session"), null);
});

test("session cookies are HttpOnly and secure in production", () => {
  const cookie = sessionCookie("secret", 3600, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(clearSessionCookie(true), /Max-Age=0/);
});
