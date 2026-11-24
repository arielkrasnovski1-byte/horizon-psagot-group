/* ============================================================
   הורייזון פסגות גרופ — nadlanIngest: כתובת הקליטה של סורק הנדל"ן
   המחשב של השמאי שולח לכאן את תוצאות הסריקה (POST, JSON) עם קוד סודי בכותרת.
   הקוד מאפשר רק דבר אחד: להוסיף/לעדכן נכסים ב-properties. אי אפשר לקרוא דרכו שום דבר.
   הלוגיקה ב-nadlan-core.js. הגדרות והתקנה: README-NADLAN.md
   ============================================================ */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const core = require('./nadlan-core');

const NADLAN_TOKEN = defineSecret('NADLAN_TOKEN');   // קוד החיבור — אותו קוד שמודבק ב"הגדרת דסק" במחשב של הסורק

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function validToken(given, secret) {
  if (!secret || secret.length < 20 || !given) return false;
  return crypto.timingSafeEqual(sha(given), sha(secret));
}

exports.nadlanIngest = onRequest(
  { region: 'europe-west1', memory: '256MiB', timeoutSeconds: 60, maxInstances: 2, concurrency: 1, secrets: [NADLAN_TOKEN] },
  async (req, res) => {
    if (req.method !== 'POST') return res.sendStatus(405);
    if (!validToken(String(req.get('x-nadlan-token') || ''), String(NADLAN_TOKEN.value() || '').trim())) return res.sendStatus(401);
    try {
      const out = await core.ingest({ db: admin.firestore(), now: () => new Date() }, req.body);
      res.status(200).json(out);
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ ok: false, error: e.message });
      console.error('nadlanIngest', e);
      res.status(500).json({ ok: false, error: 'internal' });
    }
  },
);
exports._validToken = validToken;
