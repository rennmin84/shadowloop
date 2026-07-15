'use strict';
/* =========================================================
   Shadowloop — YouTube shadowing practice
   Single-file vanilla JS · no backend · localStorage · GitHub Pages
   ========================================================= */

/* ---------------- utils ---------------- */
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round1 = v => Math.round(v * 10) / 10;

function fmtTime(sec, tenth=false){
  if (sec == null || isNaN(sec)) return '–:––';
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const sInt = Math.floor(s);
  const t = Math.floor((s - sInt) * 10 + 1e-6);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  let out = (h ? h + ':' : '') + mm + ':' + String(sInt).padStart(2, '0');
  if (tenth) out += '.' + t;
  return out;
}

function parseTimeStr(str){
  if (str == null) return null;
  const parts = String(str).trim().split(':');
  if (!parts.length || parts.length > 3) return null;
  const secM = parts.pop().match(/^(\d{1,2})(?:\.(\d+))?$/);
  if (!secM) return null;
  let sec = parseInt(secM[1], 10) + (secM[2] ? parseFloat('0.' + secM[2]) : 0);
  if (parts.length){
    const m = parts.pop();
    if (!/^\d{1,3}$/.test(m)) return null;
    sec += parseInt(m, 10) * 60;
  }
  if (parts.length){
    const h = parts.pop();
    if (!/^\d{1,3}$/.test(h)) return null;
    sec += parseInt(h, 10) * 3600;
  }
  return isNaN(sec) ? null : sec;
}

function dateStr(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;         // always local time zone
}
const todayStr = () => dateStr(new Date());
function dateStrPlus(days){
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days);
  return dateStr(d);
}

function uuid(){
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function relTime(ts){
  if (!ts) return 'not practiced yet';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function thumbUrl(videoId){
  return videoId ? 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg' : '';
}

/* ---------------- toast ---------------- */
function toast(msg, opts = {}){
  const wrap = $('#toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (opts.action){
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = opts.action.label;
    b.addEventListener('click', () => { opts.action.fn(); el.remove(); });
    el.appendChild(b);
  }
  wrap.appendChild(el);
  setTimeout(() => el.remove(), opts.duration || (opts.action ? 8000 : 3000));
}

/* ---------------- storage ---------------- */
const LS = {
  seg: 'shadowloop_segments_v1',
  log: 'shadowloop_logs_v1',
  set: 'shadowloop_settings_v1',
};
function lsLoad(key, fallback){
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function lsSave(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch (e) { toast('Could not write to local storage (private mode?)'); }
}

let segments = lsLoad(LS.seg, []);
let logs     = lsLoad(LS.log, []);
let settings = Object.assign(
  { dailyGoal: 10, streakFreezes: 0, defaultSpeed: 1, defaultLen: 2, folders: [],
    syncUrl: '', lastSyncAt: 0, micEnabled: false },
  lsLoad(LS.set, {})
);
// migrate older segments: ensure folder + len + spaced-repetition fields
function migrateSegment(s){
  if (s.folder == null) s.folder = 'Uncategorized';
  if (s.len == null && s.a != null && s.b != null) s.len = round1(s.b - s.a);
  if (s.dueDate == null){
    s.srsLevel = 0;
    if (s.lastPracticedAt){
      const d = new Date(s.lastPracticedAt); d.setDate(d.getDate() + 1);
      s.dueDate = dateStr(d);
    } else {
      s.dueDate = todayStr();
    }
  }
}
segments.forEach(migrateSegment);

let applyingRemote = false;   // true while merging cloud data, to avoid sync feedback loops
const saveSegments = () => { lsSave(LS.seg, segments); if (!applyingRemote) scheduleSync(); };
const saveLogs     = () => { lsSave(LS.log, logs);     if (!applyingRemote) scheduleSync(); };
const saveSettings = () => lsSave(LS.set, settings);

const DEFAULT_FOLDER = 'Uncategorized';

/* ---------------- app state ---------------- */
const state = {
  videoId: null,
  url: '',
  title: '',
  duration: 0,
  a: null,                     // clip start
  len: settings.defaultLen || 2,
  b: null,                     // computed = a + len
  speed: 1,                    // fixed playback rate
  currentSegmentId: null,
  folderFilter: null,          // null = All
  folderSort: 'recent',        // recent | name | count
  clipSort: 'recent',          // recent | reps | name
  hmView: 'm1',                // m1 | m3 | y1
  pendingVideo: null,          // {videoId, start} waiting for API ready
  queue: null,                 // review queue: array of segment ids, or null
  queueIndex: 0,
};
const LEN_MIN = 0.5, LEN_MAX = 8;
const isCoarse = matchMedia('(pointer: coarse)').matches;

/* rep detection engine state */
const rep = {
  armed: false,
  accum: 0,
  lastT: null, lastWall: null,
  startPending: false,
  startOK: false,
  invalid: false,
  pauseStart: null,
  preview: null,
};
function armRep(){
  rep.armed = true; rep.accum = 0;
  rep.lastT = null; rep.lastWall = null;
  rep.startPending = true; rep.startOK = false;
  rep.invalid = false; rep.pauseStart = null;
  rep.preview = null;
}
function disarmRep(){ rep.armed = false; rep.startPending = false; }
function invalidateRep(){ rep.invalid = true; }

/* ---------------- YouTube URL parsing ---------------- */
function parseTParam(t){
  if (!t) return 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const m = String(t).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
}
function parseYouTubeUrl(input){
  input = String(input || '').trim();
  if (!input) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return { videoId: input, start: 0 };
  const m = input.match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!m) return null;
  let start = 0;
  try {
    const u = new URL(input.startsWith('http') ? input : 'https://' + input);
    start = parseTParam(u.searchParams.get('t') || u.searchParams.get('start'));
  } catch (e) {}
  return { videoId: m[1], start };
}

/* ---------------- YouTube IFrame Player ---------------- */
let player = null, ytApiLoading = false, playerReady = false;
let pollTimer = null;
let programmaticPause = false;   // suppress start-capture on preview/replay-end pauses

function loadYTApi(){
  if (window.YT && window.YT.Player) return true;
  if (!ytApiLoading){
    ytApiLoading = true;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }
  return false;
}
window.onYouTubeIframeAPIReady = function(){
  if (state.pendingVideo){
    const p = state.pendingVideo;
    state.pendingVideo = null;
    createPlayer(p.videoId, p.start);
  }
};

function createPlayer(videoId, start){
  const pv = { playsinline: 1, rel: 0, controls: 1, start: Math.floor(start || 0) };
  // YouTube needs a valid origin/referer, otherwise it throws Error 153. file:// has no origin.
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    pv.origin = location.origin;
  } else {
    toast('Open via an http(s) server (not file://), or YouTube throws Error 153', { duration: 8000 });
  }
  player = new YT.Player('player', {
    videoId,
    playerVars: pv,
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: (e) => {
        if (e && e.data === 153) toast('Error 153: open via an http(s) server, not the file directly', { duration: 8000 });
        else toast('Could not load the video — check the link');
      },
    },
  });
}

function loadVideo(videoId, start = 0){
  state.videoId = videoId;
  state.url = 'https://www.youtube.com/watch?v=' + videoId;
  state.title = '';
  state.duration = 0;
  $('#player-placeholder').classList.add('hidden');
  $('#video-title').textContent = '';

  if (!loadYTApi()){
    state.pendingVideo = { videoId, start };
    return;
  }
  if (!player){
    createPlayer(videoId, start);
  } else {
    playerReady = true;
    player.cueVideoById({ videoId, startSeconds: start });
  }
  updateAll();
}

function onPlayerReady(){
  playerReady = true;
  refreshVideoMeta();
  updateAll();
}
function refreshVideoMeta(){
  if (!player || !playerReady) return;
  try {
    const d = player.getDuration();
    if (d && d > 0) state.duration = d;
    const vd = player.getVideoData && player.getVideoData();
    if (vd && vd.title){ state.title = vd.title; $('#video-title').textContent = vd.title; }
  } catch (e) {}
}

function onPlayerStateChange(ev){
  const S = YT.PlayerState;
  refreshVideoMeta();

  if (ev.data === S.PLAYING){
    // resuming from pause: paused > 10s invalidates this rep
    if (rep.armed && rep.pauseStart != null){
      if (performance.now() - rep.pauseStart > 10000) invalidateRep();
      rep.pauseStart = null;
    }
    rep.lastT = null; rep.lastWall = null;    // reset baseline so pause/buffer isn't mistaken for a seek
    stopPausedPoll();
    startPoll();
    if (rep.armed) setPlayVisual('playing');
    else if (!rep.preview) setPlayVisual('playing');
  }
  else if (ev.data === S.PAUSED){
    if (rep.armed) rep.pauseStart = performance.now();
    rep.lastT = null; rep.lastWall = null;
    stopPoll();
    // 1a: capture the current time as the clip start on a manual pause,
    // unless this pause was programmatic (preview end / replay finished).
    if (!rep.armed && !rep.preview && !programmaticPause){
      captureStartFromPlayer();
    }
    programmaticPause = false;
    // while paused, keep watching the playhead: seeking on the paused
    // timeline moves the clip start along with it
    startPausedPoll();
    if (!rep.armed && document.body.dataset.playstate !== 'waiting') setPlayVisual('idle');
  }
  else if (ev.data === S.BUFFERING){
    rep.lastT = null; rep.lastWall = null;    // buffering time isn't counted and isn't a seek
    stopPausedPoll();
  }
  else if (ev.data === S.ENDED){
    stopPoll();
    stopPausedPoll();
    if (rep.armed && state.b != null && state.duration && state.b >= state.duration - 0.6){
      handleReachB();
    } else {
      disarmRep();
      setPlayVisual('idle');
    }
  }
  else if (ev.data === S.CUED){
    refreshVideoMeta();
    stopPoll();
    stopPausedPoll();
    updateAll();
  }
}

/* ---------------- paused-seek watcher ----------------
   The IFrame API fires no event when the user drags the timeline while
   paused, so we poll slowly: if the playhead moved while paused, the
   user seeked — follow it with the clip start. */
let pausedPollTimer = null, pausedLastT = null;
function startPausedPoll(){
  if (pausedPollTimer) return;
  try { pausedLastT = player.getCurrentTime(); } catch (e) { pausedLastT = null; }
  pausedPollTimer = setInterval(pausedTick, 300);
}
function stopPausedPoll(){
  if (pausedPollTimer){ clearInterval(pausedPollTimer); pausedPollTimer = null; }
  pausedLastT = null;
}
function pausedTick(){
  if (!player || !playerReady) return;
  let st, t;
  try { st = player.getPlayerState(); t = player.getCurrentTime(); } catch (e) { return; }
  if (st !== YT.PlayerState.PAUSED) return;
  if (pausedLastT != null && Math.abs(t - pausedLastT) > 0.25){
    setStart(t);
    if (document.body.dataset.playstate === 'waiting') setPlayVisual('idle');
  }
  pausedLastT = t;
}

/* ---------------- polling (only while playing) ---------------- */
function startPoll(){
  if (pollTimer) return;
  pollTimer = setInterval(pollTick, 120);
}
function stopPoll(){
  if (pollTimer){ clearInterval(pollTimer); pollTimer = null; }
}
function pollTick(){
  if (!player || !playerReady) return;
  let t;
  try { t = player.getCurrentTime(); } catch (e) { return; }
  const now = performance.now();

  if (rep.armed){
    if (rep.startPending){
      if (t >= state.a - 0.6 && t <= state.a + 1.2){
        rep.startOK = true; rep.startPending = false;
      } else if (t > state.a + 1.2){
        rep.startPending = false; invalidateRep();
      }
    }
    if (rep.lastT != null && rep.lastWall != null){
      const wallDelta  = (now - rep.lastWall) / 1000;
      const mediaDelta = t - rep.lastT;
      const expected   = wallDelta * state.speed;
      if (Math.abs(mediaDelta - expected) > Math.max(1.0, expected * 0.5 + 0.8)){
        invalidateRep();
        rep.accum = 0;
      } else {
        rep.accum += wallDelta;
      }
    }
    rep.lastT = t; rep.lastWall = now;
  }

  if (rep.preview){
    if (t >= rep.preview.end){
      rep.preview = null;
      programmaticPause = true;
      try { player.pauseVideo(); } catch (e) {}
      setPlayVisual('idle');
      if (abPending){ abPending = false; playMine(); }
    }
  }
  else if (rep.armed && state.b != null && t >= state.b - 0.05){
    handleReachB();
  }
}

function repIsValid(){
  if (rep.invalid || !rep.startOK) return false;
  const len = state.b - state.a;
  if (len <= 0) return false;
  const need = (len * 0.8) / state.speed;   // accumulated play time >= clip length * 0.8 / speed
  return rep.accum >= need;
}

function handleReachB(){
  const valid = repIsValid();
  disarmRep();
  programmaticPause = true;
  try { player.pauseVideo(); } catch (e) {}
  if (valid) countRep();
  setPlayVisual('waiting');   // stopped = your turn to speak
  startTake();                // echo: record the user's shadowing attempt
}

/* ---------------- rep counting & logs ---------------- */
function todayTotal(){
  const d = todayStr();
  return logs.reduce((sum, l) => sum + (l.date === d ? l.reps : 0), 0);
}
function segTodayReps(segId){
  if (!segId) return 0;
  const d = todayStr();
  const log = logs.find(l => l.date === d && l.segmentId === segId);
  return log ? log.reps : 0;
}

function defaultLabel(){
  return (state.title ? state.title + ' ' : '') + fmtTime(state.a) + ' (' + state.len.toFixed(1) + 's)';
}

function makeSegment(fields = {}){
  return Object.assign({
    schemaVersion: 2,
    id: uuid(),
    videoId: state.videoId,
    url: state.url,
    title: state.title,
    a: state.a, b: state.b, len: state.len,
    label: defaultLabel(),
    note: '',
    folder: DEFAULT_FOLDER,
    playlistId: null,                 // reserved for phase 2
    reps: 0,
    createdAt: Date.now(),
    lastPracticedAt: 0,
    srsLevel: 0,
    dueDate: dateStrPlus(1),          // first review: tomorrow
  }, fields);
}

function countRep(){
  // Only saved clips count. Before saving, Replay is a preview and does not tick reps.
  const seg = state.currentSegmentId ? segments.find(s => s.id === state.currentSegmentId) : null;
  if (!seg) return;
  seg.reps += 1;
  seg.lastPracticedAt = Date.now();
  seg.a = state.a; seg.b = state.b; seg.len = state.len;
  saveSegments();

  const d = todayStr();
  const before = todayTotal();
  let log = logs.find(l => l.date === d && l.segmentId === seg.id);
  if (!log){ log = { date: d, segmentId: seg.id, reps: 0 }; logs.push(log); }
  log.reps += 1;
  saveLogs();

  updateRepButton(true);

  // SRS: clearing a due clip levels it up and schedules the next review
  if (isDue(seg) && segTodayReps(seg.id) >= REVIEW_REPS){
    seg.srsLevel = Math.min((seg.srsLevel || 0) + 1, SRS_INTERVALS.length - 1);
    seg.dueDate = dateStrPlus(SRS_INTERVALS[seg.srsLevel]);
    saveSegments();
    if (state.queue && seg.id === queueCurrentId()){
      toast('✓ Cleared — next clip');
      setTimeout(queueAdvance, 1200);
    } else {
      toast('✓ Reviewed — due again in ' + SRS_INTERVALS[seg.srsLevel] + 'd');
    }
  }
  if (state.queue) updateQueueRep();

  if (before < settings.dailyGoal && before + 1 >= settings.dailyGoal){
    const st = computeStreak();
    toast('🎉 Daily goal reached! ' + st.streak + '-day streak');
  }
  renderDashboard();
}

/* ---------------- playback actions ---------------- */
function doReplay(){
  if (!playerReady || !state.videoId){ toast('Load a video first'); return; }
  if (state.a == null || state.b == null || state.b <= state.a){
    toast('Mark a start point first'); return;
  }
  takeAudio.pause();
  abPending = false;
  if (rec.recorder) stopTake(false);
  if (settings.micEnabled) ensureMic();   // warm the mic up so recording can start at the pause
  armRep();
  try {
    player.setPlaybackRate(1);
    player.seekTo(state.a, true);
    player.playVideo();
  } catch (e) {}
  setPlayVisual('playing');
}

function previewCut(){
  const t = state.a;
  if (t == null){ toast('Mark a start point first'); return; }
  if (!playerReady) return;
  disarmRep();
  rep.preview = { end: t + 0.5 };
  try {
    player.setPlaybackRate(1);
    player.seekTo(Math.max(0, t - 0.5), true);
    player.playVideo();
  } catch (e) {}
}

function setPlayVisual(mode){ document.body.dataset.playstate = mode; }

function seekRelative(delta){
  if (!playerReady || !state.videoId){ toast('Load a video first'); return; }
  let t, st;
  try { t = player.getCurrentTime(); st = player.getPlayerState(); } catch (e) { return; }
  if (rep.armed) disarmRep();
  rep.preview = null;
  const target = clamp(round1(t + delta), 0, state.duration || 36000);
  try { player.seekTo(target, true); } catch (e) {}
  const playing = st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING;
  if (!playing){
    // paused jump: move the clip start along with the playhead
    setStart(target);
    pausedLastT = target;
    if (document.body.dataset.playstate === 'waiting') setPlayVisual('idle');
  }
}

/* ---------------- echo: record yourself & compare ----------------
   When the mic is on, every finished Replay starts a short recording
   (clip length + a beat). The latest take per saved clip is kept in
   IndexedDB so you can come back and hear your last attempt. */
const rec = {
  stream: null,
  recorder: null,
  chunks: [],
  discard: false,
  timer: null,
  takeUrl: null,
  takeAt: 0,
  takeSegId: null,
};
const takeAudio = new Audio();
let abPending = false;

/* --- IndexedDB: one take per segment --- */
let idbPromise = null;
function idbOpen(){
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('shadowloop', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('takes');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}
async function idbPutTake(segId, blob){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('takes', 'readwrite');
    tx.objectStore('takes').put({ blob, at: Date.now() }, segId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGetTake(segId){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction('takes').objectStore('takes').get(segId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbDelTake(segId){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('takes', 'readwrite');
    tx.objectStore('takes').delete(segId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* --- echo UI state machine: off | ready | recording | take --- */
function echoUI(){
  const bar = $('#echo-bar');
  $('#mic-toggle').classList.toggle('on', !!settings.micEnabled);
  if (!settings.micEnabled){
    bar.dataset.echo = 'off';
    $('#echo-status').textContent = 'Mic off — turn it on to hear yourself vs. the original';
    $('#echo-actions').classList.add('hidden');
  } else if (rec.recorder){
    bar.dataset.echo = 'recording';
    $('#echo-status').textContent = 'Recording — speak now · tap to stop';
    $('#echo-actions').classList.add('hidden');
  } else if (rec.takeUrl){
    bar.dataset.echo = 'take';
    $('#echo-status').textContent = 'Your take · ' + relTime(rec.takeAt);
    $('#echo-actions').classList.remove('hidden');
  } else {
    bar.dataset.echo = 'ready';
    $('#echo-status').textContent = 'Mic on — after Replay ends, speak: you\'ll be recorded';
    $('#echo-actions').classList.add('hidden');
  }
}

async function ensureMic(){
  if (!settings.micEnabled) return false;
  if (rec.stream && rec.stream.active) return true;
  if (!navigator.mediaDevices || !window.MediaRecorder){
    toast('Recording is not supported in this browser');
    settings.micEnabled = false; saveSettings(); echoUI();
    return false;
  }
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    return true;
  } catch (e) {
    toast('Microphone permission was denied');
    settings.micEnabled = false; saveSettings(); echoUI();
    return false;
  }
}

function pickRecMime(){
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return (window.MediaRecorder && cands.find(m => MediaRecorder.isTypeSupported(m))) || '';
}

function startTake(){
  if (!settings.micEnabled || !rec.stream || !rec.stream.active || rec.recorder) return;
  try {
    const mime = pickRecMime();
    rec.recorder = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  } catch (e) { rec.recorder = null; return; }
  rec.chunks = [];
  rec.discard = false;
  rec.recorder.ondataavailable = ev => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
  rec.recorder.onstop = () => {
    const type = (rec.recorder && rec.recorder.mimeType) || 'audio/webm';
    rec.recorder = null;
    clearTimeout(rec.timer); rec.timer = null;
    if (rec.discard || !rec.chunks.length){ rec.discard = false; rec.chunks = []; echoUI(); return; }
    const blob = new Blob(rec.chunks, { type });
    rec.chunks = [];
    if (rec.takeUrl) URL.revokeObjectURL(rec.takeUrl);
    rec.takeUrl = URL.createObjectURL(blob);
    rec.takeAt = Date.now();
    rec.takeSegId = state.currentSegmentId;
    if (state.currentSegmentId) idbPutTake(state.currentSegmentId, blob).catch(() => {});
    echoUI();
  };
  try { rec.recorder.start(); } catch (e) { rec.recorder = null; return; }
  const ms = clamp(state.len * 1000 + 1500, 2000, 15000);   // your turn ≈ clip length + a beat
  rec.timer = setTimeout(() => stopTake(false), ms);
  echoUI();
}
function stopTake(discard){
  clearTimeout(rec.timer); rec.timer = null;
  if (!rec.recorder) return;
  rec.discard = !!discard;
  try { rec.recorder.stop(); } catch (e) { rec.recorder = null; echoUI(); }
}
function clearTake(){
  stopTake(true);
  if (rec.takeUrl) URL.revokeObjectURL(rec.takeUrl);
  rec.takeUrl = null; rec.takeAt = 0; rec.takeSegId = null;
  echoUI();
}
function loadTakeFor(segId){
  rec.takeSegId = segId;
  if (!segId){ clearTake(); return; }
  idbGetTake(segId).then(item => {
    if (rec.takeSegId !== segId) return;      // user moved on meanwhile
    if (rec.takeUrl) URL.revokeObjectURL(rec.takeUrl);
    if (item && item.blob){
      rec.takeUrl = URL.createObjectURL(item.blob);
      rec.takeAt = item.at || 0;
    } else {
      rec.takeUrl = null; rec.takeAt = 0;
    }
    echoUI();
  }).catch(() => {});
}

function playMine(){
  if (!rec.takeUrl){ toast('No take yet — hit Replay, then speak'); return; }
  if (playerReady){
    try {
      const st = player.getPlayerState();
      if (st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING){
        programmaticPause = true;
        player.pauseVideo();
      }
    } catch (e) {}
  }
  takeAudio.src = rec.takeUrl;
  takeAudio.currentTime = 0;
  takeAudio.play().then(() => {
    $('#play-mine').classList.add('playing');
  }).catch(() => toast('Tap ▶ My voice to play'));
}
takeAudio.addEventListener('ended', () => $('#play-mine').classList.remove('playing'));
takeAudio.addEventListener('pause', () => $('#play-mine').classList.remove('playing'));

function playOriginalClip(){
  if (!playerReady || state.a == null || state.b == null){ toast('Mark a start point first'); return; }
  takeAudio.pause();
  if (rec.recorder) stopTake(false);
  disarmRep();
  rep.preview = { end: state.b };
  try {
    player.setPlaybackRate(1);
    player.seekTo(state.a, true);
    player.playVideo();
  } catch (e) {}
}

/* ---------------- start + length model ---------------- */
function recomputeB(){
  if (state.a == null){ state.b = null; return; }
  const max = state.duration || 36000;
  state.b = clamp(round1(state.a + state.len), 0, max);
}
function setStart(val){
  if (val == null || isNaN(val)) return;
  const max = state.duration || 36000;
  state.a = clamp(round1(val), 0, max);
  recomputeB();
  state.currentSegmentId = findMatchingSegmentId();
  updateAll();
}
function captureStartFromPlayer(){
  if (!playerReady) return;
  let t;
  try { t = player.getCurrentTime(); } catch (e) { return; }
  setStart(round1(t));
}
function nudgeStart(delta){
  if (state.a == null){ toast('Pause the video at a start point first'); return; }
  setStart(state.a + delta);
}
function changeLen(delta){
  state.len = clamp(round1(state.len + delta), LEN_MIN, LEN_MAX);
  settings.defaultLen = state.len; saveSettings();
  recomputeB();
  state.currentSegmentId = findMatchingSegmentId();
  updateAll();
}

function findMatchingSegmentId(){
  if (state.a == null || state.b == null || !state.videoId) return null;
  const seg = segments.find(s =>
    s.videoId === state.videoId &&
    Math.abs(s.a - state.a) < 0.35 && Math.abs(s.b - state.b) < 0.35);
  return seg ? seg.id : null;
}

/* ---------------- press-and-hold repeat (nudge buttons) ---------------- */
function bindHold(btn, fn){
  let delayT = null, repeatT = null;
  const start = e => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    fn();
    delayT = setTimeout(() => { repeatT = setInterval(fn, 150); }, 400);
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const end = () => { clearTimeout(delayT); clearInterval(repeatT); delayT = repeatT = null; };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, end));
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------------- UI sync ---------------- */
function updateAll(){
  $('#time-a').value = state.a != null ? fmtTime(state.a, true) : '';
  $('#len-val').textContent = state.len.toFixed(1) + 's';
  updateRepButton(false);
}
function updateRepButton(bump){
  const btn = $('#replay-btn');
  const ready = playerReady && state.a != null && state.b != null && state.b > state.a;
  btn.disabled = !ready;
  const wrap = $('#rep-count');
  const saved = !!state.currentSegmentId;
  $('#replay-label').textContent = saved ? 'Replay' : 'Replay (preview)';
  if (saved){
    wrap.classList.remove('hidden');
    $('#rep-count-num').textContent = segTodayReps(state.currentSegmentId);
    if (bump){
      wrap.classList.remove('bump'); void wrap.offsetWidth;
      wrap.classList.add('bump');
    }
  } else {
    wrap.classList.add('hidden');
  }
}

/* ---------------- folders ---------------- */
function allFolders(){
  const set = new Set(settings.folders);
  segments.forEach(s => set.add(s.folder || DEFAULT_FOLDER));
  set.add(DEFAULT_FOLDER);
  return [...set];
}
function ensureFolder(name){
  if (!name) return;
  if (!settings.folders.includes(name)){ settings.folders.push(name); saveSettings(); }
}

/* ---------------- clip CRUD ---------------- */
function openSaveModal(){
  if (state.a == null || state.b == null || !state.videoId){
    toast('Mark a start point first'); return;
  }
  const seg = state.currentSegmentId ? segments.find(s => s.id === state.currentSegmentId) : null;
  $('#modal-title').textContent = seg ? 'Update clip' : 'Save clip';

  const thumb = $('#modal-thumb');
  const tu = thumbUrl(seg ? seg.videoId : state.videoId);
  if (tu){
    thumb.src = tu; thumb.classList.remove('hidden');
    thumb.onerror = () => thumb.classList.add('hidden');
  } else {
    thumb.classList.add('hidden');
  }

  $('#seg-label').value = seg ? seg.label : defaultLabel();
  $('#seg-note').value  = seg ? seg.note : '';

  // folder select
  const sel = $('#seg-folder');
  sel.innerHTML = '';
  const preferred = seg ? (seg.folder || DEFAULT_FOLDER) : (state.folderFilter || DEFAULT_FOLDER);
  allFolders().forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    if (name === preferred) o.selected = true;
    sel.appendChild(o);
  });
  const nw = document.createElement('option');
  nw.value = '__new__'; nw.textContent = '＋ New folder…';
  sel.appendChild(nw);
  $('#new-folder-field').classList.add('hidden');
  $('#seg-folder-new').value = '';

  $('#modal-backdrop').classList.remove('hidden');
  setTimeout(() => $('#seg-label').focus(), 50);
}
function closeSaveModal(){ $('#modal-backdrop').classList.add('hidden'); }

function resolveFolderFromModal(){
  const sel = $('#seg-folder');
  if (sel.value === '__new__'){
    const name = $('#seg-folder-new').value.trim();
    if (!name) return DEFAULT_FOLDER;
    ensureFolder(name);
    return name;
  }
  return sel.value || DEFAULT_FOLDER;
}

function saveFromModal(){
  const label  = $('#seg-label').value.trim() || defaultLabel();
  const note   = $('#seg-note').value.trim();
  const folder = resolveFolderFromModal();
  let seg = state.currentSegmentId ? segments.find(s => s.id === state.currentSegmentId) : null;
  if (seg){
    Object.assign(seg, { label, note, folder, a: state.a, b: state.b, len: state.len, title: state.title || seg.title });
  } else {
    seg = makeSegment({ label, note, folder });
    segments.push(seg);
    state.currentSegmentId = seg.id;
  }
  saveSegments();
  closeSaveModal();
  toast('Saved “' + label.slice(0, 20) + (label.length > 20 ? '…' : '') + '”');
  updateRepButton(false);
  renderDashboard();
  renderSegmentList();
}

function deleteSegment(id){
  const seg = segments.find(s => s.id === id);
  if (!seg) return;
  if (!confirm('Delete “' + seg.label + '”? Your practice stats stay intact.')) return;
  segments = segments.filter(s => s.id !== id);
  if (state.currentSegmentId === id) state.currentSegmentId = null;
  idbDelTake(id).catch(() => {});
  if (state.queue){
    const wasCurrent = queueCurrentId() === id;
    const pos = state.queue.indexOf(id);
    if (pos !== -1){
      state.queue.splice(pos, 1);
      if (pos < state.queueIndex) state.queueIndex--;
    }
    if (!state.queue.length) exitReview();
    else {
      state.queueIndex = Math.min(state.queueIndex, state.queue.length - 1);
      if (wasCurrent) loadSegment(state.queue[state.queueIndex]);
      renderQueueBar();
    }
  }
  saveSegments();
  renderDashboard();
  renderSegmentList();
  toast('Deleted');
}

function loadSegment(id){
  const seg = segments.find(s => s.id === id);
  if (!seg) return;
  showView('practice');
  loadTakeFor(seg.id);
  const apply = () => {
    state.a = seg.a; state.b = seg.b;
    state.len = seg.len != null ? seg.len : round1(seg.b - seg.a);
    state.currentSegmentId = seg.id;
    updateAll();
  };
  if (state.videoId !== seg.videoId){
    loadVideo(seg.videoId, Math.max(0, seg.a - 0.5));
    apply();
  } else {
    apply();
    if (playerReady){ try { player.seekTo(seg.a, true); player.pauseVideo(); } catch (e) {} }
  }
}

function shareSegment(seg){
  const u = new URL(location.origin + location.pathname);
  u.searchParams.set('v', seg.videoId);
  u.searchParams.set('a', seg.a);
  u.searchParams.set('b', seg.b);
  if (seg.label) u.searchParams.set('label', seg.label);
  const link = u.toString();
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(link)
      .then(() => toast('Share link copied'))
      .catch(() => prompt('Copy this link:', link));
  } else {
    prompt('Copy this link:', link);
  }
}

/* ---------------- clip list (two-pane) ---------------- */
function folderStats(){
  const counts = {}, reps = {}, last = {};
  segments.forEach(s => {
    const f = s.folder || DEFAULT_FOLDER;
    counts[f] = (counts[f] || 0) + 1;
    reps[f]   = (reps[f]   || 0) + (s.reps || 0);
    last[f]   = Math.max(last[f] || 0, s.lastPracticedAt || s.createdAt || 0);
  });
  return { counts, reps, last };
}

function orderedFolders(stats){
  let names = allFolders().filter(name =>
    !(name === DEFAULT_FOLDER && !stats.counts[name] && settings.folders.indexOf(name) === -1));
  const sort = state.folderSort;
  names.sort((a, b) => {
    if (sort === 'name')  return a.localeCompare(b);
    if (sort === 'count') return (stats.counts[b] || 0) - (stats.counts[a] || 0) || a.localeCompare(b);
    return (stats.last[b] || 0) - (stats.last[a] || 0) || a.localeCompare(b);  // recent
  });
  return names;
}

function sortedClips(list){
  const arr = list.slice();
  const sort = state.clipSort;
  arr.sort((x, y) => {
    if (sort === 'name') return (x.label || '').localeCompare(y.label || '');
    if (sort === 'reps') return (y.reps || 0) - (x.reps || 0);
    return (y.lastPracticedAt || y.createdAt) - (x.lastPracticedAt || x.createdAt);  // recent
  });
  return arr;
}

function renderSegmentList(){
  const stats = folderStats();

  // ---- folders pane ----
  const fl = $('#folder-list');
  if (fl){
    fl.innerHTML = '';
    const mkRow = (label, value, count, reps) => {
      const li = document.createElement('li');
      li.className = 'folder-row' + (state.folderFilter === value ? ' active' : '');
      li.innerHTML =
        '<span class="fr-name">' + escapeHtml(label) + '</span>' +
        '<span class="fr-meta">' + count + (reps != null ? ' · ' + reps + '↻' : '') + '</span>';
      li.addEventListener('click', () => { state.folderFilter = value; renderSegmentList(); });
      fl.appendChild(li);
    };
    const totalReps = segments.reduce((s, x) => s + (x.reps || 0), 0);
    mkRow('All', null, segments.length, totalReps);
    orderedFolders(stats).forEach(name =>
      mkRow(name, name, stats.counts[name] || 0, stats.reps[name] || 0));
  }

  // ---- clips pane ----
  let list = segments.slice();
  if (state.folderFilter) list = list.filter(s => (s.folder || DEFAULT_FOLDER) === state.folderFilter);
  list = sortedClips(list);

  const titleEl = $('#clips-pane-title');
  if (titleEl) titleEl.textContent = state.folderFilter || 'All clips';

  const ul = $('#segment-list');
  ul.innerHTML = '';
  $('#segment-list-empty').classList.toggle('hidden', list.length > 0);

  list.forEach(seg => {
    const li = document.createElement('li');
    li.className = 'seg-item';
    li.setAttribute('role', 'button');
    li.tabIndex = 0;
    li.title = 'Practice this clip';
    li.innerHTML =
      '<img class="seg-thumb" src="' + thumbUrl(seg.videoId) + '" alt="">' +
      '<div class="seg-info">' +
        '<div class="seg-label">' + escapeHtml(seg.label) + '</div>' +
        '<div class="seg-meta">' + escapeHtml(seg.title || seg.videoId) + ' · ' +
          fmtTime(seg.a) + ' · ' + (seg.len != null ? seg.len.toFixed(1) : round1(seg.b - seg.a).toFixed(1)) + 's · ' +
          seg.reps + ' reps · ' + relTime(seg.lastPracticedAt) + '</div>' +
        '<div class="seg-folder"><span>' + escapeHtml(seg.folder || DEFAULT_FOLDER) + '</span></div>' +
      '</div>' +
      '<span class="seg-go">▶</span>' +
      '<button class="seg-del" title="Delete clip" aria-label="Delete clip">✕</button>';
    const thumb = li.querySelector('.seg-thumb');
    thumb.addEventListener('error', () => { thumb.style.display = 'none'; });
    li.addEventListener('click', () => loadSegment(seg.id));
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); loadSegment(seg.id); } });
    const del = li.querySelector('.seg-del');
    del.addEventListener('click', e => { e.stopPropagation(); deleteSegment(seg.id); });
    ul.appendChild(li);
  });
}

/* ---------------- review queue (spaced repetition) ----------------
   Anki-style intervals. A clip is "due" when its dueDate has arrived;
   clearing it (REVIEW_REPS reps that day) bumps it to the next interval. */
const REVIEW_REPS = 3;
const SRS_INTERVALS = [1, 3, 7, 14, 30];

function isDue(seg){ return (seg.dueDate || todayStr()) <= todayStr(); }
function dueSegments(){
  return segments
    .filter(isDue)
    .sort((a, b) =>
      (a.dueDate || '').localeCompare(b.dueDate || '') ||
      (a.lastPracticedAt || 0) - (b.lastPracticedAt || 0));
}

function queueCurrentId(){ return state.queue ? state.queue[state.queueIndex] : null; }

function startReview(){
  const due = dueSegments();
  if (!due.length){ toast('Nothing due today — nice!'); return; }
  state.queue = due.map(s => s.id);
  state.queueIndex = 0;
  loadSegment(state.queue[0]);
  renderQueueBar();
}
function exitReview(){
  state.queue = null;
  state.queueIndex = 0;
  renderQueueBar();
}
function queueAdvance(){
  if (!state.queue) return;
  if (state.queueIndex + 1 >= state.queue.length){
    exitReview();
    toast('🎉 Review complete — every due clip cleared!');
    renderDashboard();
    return;
  }
  state.queueIndex++;
  loadSegment(state.queue[state.queueIndex]);
  renderQueueBar();
}
function renderQueueBar(){
  const bar = $('#queue-bar');
  if (!state.queue){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#queue-progress').textContent = (state.queueIndex + 1) + ' / ' + state.queue.length;
  const dots = $('#queue-dots');
  dots.innerHTML = '';
  if (state.queue.length <= 14){
    state.queue.forEach((id, i) => {
      const d = document.createElement('i');
      d.className = 'qdot' + (i < state.queueIndex ? ' done' : i === state.queueIndex ? ' cur' : '');
      dots.appendChild(d);
    });
  }
  updateQueueRep();
}
function updateQueueRep(){
  if (!state.queue) return;
  const n = Math.min(segTodayReps(queueCurrentId()), REVIEW_REPS);
  $('#queue-rep').textContent = 'Rep ' + n + ' / ' + REVIEW_REPS;
}

function renderReviewCard(){
  const sec = $('#review-section');
  if (!segments.length){ sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  const due = dueSegments();
  const badge = $('#review-badge');
  if (due.length){
    badge.classList.remove('done');
    $('#due-count').textContent = due.length;
    $('#due-word').textContent = 'due';
    $('#review-title').textContent = "Today's review";
    $('#review-sub').textContent = due.length + (due.length === 1 ? ' clip' : ' clips') + ' waiting · ' + REVIEW_REPS + ' reps each to clear';
    $('#start-review').classList.remove('hidden');
  } else {
    badge.classList.add('done');
    $('#due-count').textContent = '✓';
    $('#due-word').textContent = 'done';
    $('#review-title').textContent = 'All caught up';
    $('#review-sub').textContent = 'Nothing due — reviews come back on a 1 / 3 / 7 / 14 / 30-day rhythm';
    $('#start-review').classList.add('hidden');
  }
}

/* ---------------- dashboard: progress, streak, heatmap ---------------- */
function computeStreak(){
  const goal = settings.dailyGoal;
  const byDate = {};
  logs.forEach(l => { byDate[l.date] = (byDate[l.date] || 0) + l.reps; });
  const goalDates = Object.keys(byDate).filter(d => byDate[d] >= goal).sort();
  const t = todayStr();

  if (!goalDates.length){
    settings.streakFreezes = 0; saveSettings();
    return { streak: 0, freezes: 0 };
  }
  let balance = 0, goalCount = 0, streak = 0;
  const start = new Date(goalDates[0] + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (let d = new Date(start); d < today; d.setDate(d.getDate() + 1)){
    const ds = dateStr(d);
    if ((byDate[ds] || 0) >= goal){
      streak++; goalCount++;
      if (goalCount % 7 === 0) balance = Math.min(2, balance + 1);
    } else if (streak > 0){
      if (balance > 0) balance--;
      else streak = 0;
    }
  }
  if ((byDate[t] || 0) >= goal){
    streak++; goalCount++;
    if (goalCount % 7 === 0) balance = Math.min(2, balance + 1);
  }
  settings.streakFreezes = balance; saveSettings();
  return { streak, freezes: balance };
}

function renderDashboard(){
  const total = todayTotal();
  const goal = settings.dailyGoal;
  $('#today-reps').textContent = total;
  $('#today-goal').textContent = goal;
  const C = 2 * Math.PI * 40;
  $('#ring-fg').style.strokeDashoffset = C * (1 - clamp(total / goal, 0, 1));

  const st = computeStreak();
  $('#streak-days').textContent = st.streak;
  $('#freeze-badge').classList.toggle('hidden', st.freezes <= 0);
  $('#freeze-count').textContent = st.freezes;

  $('#goal-input').value = goal;

  const isEmpty = segments.length === 0 && logs.length === 0;
  $('#getting-started').classList.toggle('hidden', !isEmpty);
  $('#progress-section').classList.toggle('hidden', isEmpty);
  if (!isEmpty) renderHeatmap();
  renderReviewCard();
}

function renderClips(){
  renderSegmentList();
}

function hmLevel(reps, goal){
  if (reps <= 0) return 0;
  if (reps < goal * 0.5) return 1;
  if (reps < goal) return 2;
  if (reps < goal * 2) return 3;
  return 4;
}

function renderHmStats(){
  const el = $('#hm-stats');
  const repsByDate = {};
  logs.forEach(l => { repsByDate[l.date] = (repsByDate[l.date] || 0) + l.reps; });
  const totalReps = Object.values(repsByDate).reduce((a, b) => a + b, 0);
  const daysPracticed = Object.values(repsByDate).filter(r => r > 0).length;
  el.textContent = totalReps + ' reps · ' + daysPracticed + (daysPracticed === 1 ? ' day practiced' : ' days practiced');
}

function makeCell(ds, reps, goal, newCount){
  const cell = document.createElement('div');
  cell.className = 'hm-cell';
  cell.dataset.lv = hmLevel(reps, goal);
  if (newCount) cell.dataset.new = '1';
  cell.title = ds + ' · ' + reps + ' reps' + (newCount ? ' · ' + newCount + ' new clip(s)' : '');
  return cell;
}

/* one grid style for every view — same cell size, only the range changes */
const HM_WEEKS = { m1: 5, m3: 13, y1: 52 };
function renderHeatmap(){
  const el = $('#heatmap');
  el.innerHTML = '';
  const goal = settings.dailyGoal;

  const repsByDate = {};
  logs.forEach(l => { repsByDate[l.date] = (repsByDate[l.date] || 0) + l.reps; });
  const newByDate = {};
  segments.forEach(s => {
    const ds = dateStr(new Date(s.createdAt));
    newByDate[ds] = (newByDate[ds] || 0) + 1;
  });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weeks = HM_WEEKS[state.hmView] || 5;
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks - 1) * 7 - today.getDay());
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)){
    const ds = dateStr(d);
    el.appendChild(makeCell(ds, repsByDate[ds] || 0, goal, newByDate[ds]));
  }
  const sc = $('.heatmap-scroll');
  sc.scrollLeft = sc.scrollWidth;
  renderHmStats();
}

/* ---------------- export / import ---------------- */
function exportData(){
  const data = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    segments, logs, settings,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'shadowloop_backup_' + todayStr().replace(/-/g, '') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Backup exported');
}

function importData(obj){
  if (!obj || (obj.schemaVersion !== 1 && obj.schemaVersion !== 2) || !Array.isArray(obj.segments) || !Array.isArray(obj.logs)){
    toast('Unsupported file (need schemaVersion 1 or 2)'); return;
  }
  const r = mergeData(obj);
  toast('Import complete: ' + r.added + ' added, ' + r.updated + ' updated');
}

/* merge another snapshot (import file or cloud copy) into local data */
function mergeData(obj){
  // segments: same id -> keep the one with newer lastPracticedAt
  const byId = new Map(segments.map(s => [s.id, s]));
  let added = 0, updated = 0;
  obj.segments.forEach(inc => {
    if (!inc || !inc.id) return;
    migrateSegment(inc);
    const cur = byId.get(inc.id);
    if (!cur){ byId.set(inc.id, inc); added++; }
    else if ((inc.lastPracticedAt || 0) > (cur.lastPracticedAt || 0)){ byId.set(inc.id, inc); updated++; }
  });
  segments = [...byId.values()];

  // logs: same (date, segmentId) -> take the larger value
  const logKey = l => l.date + '|' + l.segmentId;
  const logMap = new Map(logs.map(l => [logKey(l), l]));
  obj.logs.forEach(inc => {
    if (!inc || !inc.date || !inc.segmentId) return;
    const cur = logMap.get(logKey(inc));
    if (!cur) logMap.set(logKey(inc), inc);
    else cur.reps = Math.max(cur.reps, inc.reps);
  });
  logs = [...logMap.values()];

  // merge folder lists (local first, then imported)
  if (obj.settings && Array.isArray(obj.settings.folders)){
    const set = new Set(settings.folders);
    obj.settings.folders.forEach(f => set.add(f));
    settings.folders = [...set];
  }

  saveSegments(); saveLogs(); saveSettings();
  renderDashboard();
  renderSegmentList();
  return { added, updated };
}

/* ---------------- cloud sync (Google Apps Script + Sheets) ----------------
   Pull the remote snapshot, merge it locally, then push the merged result.
   The merge is idempotent, so the order of devices doesn't matter. */
let syncTimer = null, syncing = false, syncQueued = false;

function setSyncStatus(msg){ $('#sync-status').textContent = msg; }
function updateSyncStatus(){
  if (!settings.syncUrl){ setSyncStatus('Cloud sync is off — paste your Apps Script web app URL above.'); return; }
  setSyncStatus(settings.lastSyncAt ? 'Last synced ' + relTime(settings.lastSyncAt) : 'Not synced yet — press Sync now.');
}

function scheduleSync(){
  if (!settings.syncUrl) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; syncNow(true); }, 5000);
}

function buildSyncPayload(){
  const s = Object.assign({}, settings);
  delete s.syncUrl;               // the URL itself stays on-device
  return JSON.stringify({
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    segments, logs, settings: s,
  });
}

async function syncNow(silent){
  const url = settings.syncUrl;
  if (!url){ if (!silent) toast('Paste your Apps Script URL first'); return; }
  if (syncing){ syncQueued = true; return; }
  syncing = true;
  setSyncStatus('Syncing…');
  try {
    const res = await fetch(url);
    const remote = await res.json();
    if (remote && remote.data && Array.isArray(remote.data.segments) && Array.isArray(remote.data.logs)){
      applyingRemote = true;
      try { mergeData(remote.data); } finally { applyingRemote = false; }
    }
    const res2 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain avoids a CORS preflight
      body: buildSyncPayload(),
    });
    const out = await res2.json();
    if (!out || !out.ok) throw new Error((out && out.error) || 'sync failed');
    settings.lastSyncAt = Date.now(); saveSettings();
    updateSyncStatus();
    if (!silent) toast('Synced ✓');
  } catch (e) {
    setSyncStatus('Sync failed — check the URL and that the deployment allows "Anyone".');
    if (!silent) toast('Sync failed');
  } finally {
    syncing = false;
    if (syncQueued){ syncQueued = false; scheduleSync(); }
  }
}

// flush a pending push when the tab is closed / backgrounded
window.addEventListener('pagehide', () => {
  if (syncTimer && settings.syncUrl && navigator.sendBeacon){
    clearTimeout(syncTimer); syncTimer = null;
    navigator.sendBeacon(settings.syncUrl, new Blob([buildSyncPayload()], { type: 'text/plain;charset=utf-8' }));
  }
});

/* ---------------- view switching ---------------- */
function showView(which){
  $('#view-home').classList.toggle('hidden', which !== 'home');
  $('#view-clips').classList.toggle('hidden', which !== 'clips');
  $('#view-practice').classList.toggle('hidden', which !== 'practice');
  $('#nav-home').classList.toggle('active', which === 'home');
  $('#nav-clips').classList.toggle('active', which === 'clips');
  $('#nav-practice').classList.toggle('active', which === 'practice');
  document.body.classList.toggle('on-practice', which === 'practice');
  if (which === 'home') renderDashboard();
  else if (which === 'clips') renderClips();
}

/* ---------------- event wiring ---------------- */
function handleUrlInput(inputEl){
  const parsed = parseYouTubeUrl(inputEl.value);
  if (!parsed){ toast('Could not read that link — paste a YouTube video URL'); return; }
  inputEl.value = '';
  state.a = null; state.b = null; state.currentSegmentId = null;
  clearTake();
  showView('practice');
  loadVideo(parsed.videoId, parsed.start);
}
[['#url-load-hero', '#url-input-hero'],
 ['#url-load-practice', '#url-input-practice'],
 ['#url-load-practice2', '#url-input-practice2']].forEach(([btn, inp]) => {
  $(btn).addEventListener('click', () => { handleUrlInput($(inp)); $('#new-video-row').classList.add('hidden'); });
  $(inp).addEventListener('keydown', e => { if (e.key === 'Enter'){ handleUrlInput($(inp)); $('#new-video-row').classList.add('hidden'); } });
});
$('#new-video-toggle').addEventListener('click', () => {
  const row = $('#new-video-row');
  row.classList.toggle('hidden');
  if (!row.classList.contains('hidden')) setTimeout(() => $('#url-input-practice2').focus(), 30);
});

$('#nav-home').addEventListener('click', () => showView('home'));
$('#nav-clips').addEventListener('click', () => showView('clips'));
$('#nav-practice').addEventListener('click', () => showView('practice'));

// clips sorting
$('#folder-sort').addEventListener('change', e => { state.folderSort = e.target.value; renderSegmentList(); });
$('#clip-sort').addEventListener('change', e => { state.clipSort = e.target.value; renderSegmentList(); });

$$('.nudge').forEach(btn => {
  const d = parseFloat(btn.dataset.d);
  bindHold(btn, () => nudgeStart(d));
});
$$('.len-btn').forEach(btn => {
  const d = parseFloat(btn.dataset.d);
  bindHold(btn, () => changeLen(d));
});
$('.preview-btn').addEventListener('click', previewCut);
$('#skip-back').addEventListener('click', () => seekRelative(-10));
$('#skip-fwd').addEventListener('click', () => seekRelative(10));

// echo: record & compare
$('#mic-toggle').addEventListener('click', async () => {
  settings.micEnabled = !settings.micEnabled;
  saveSettings();
  if (settings.micEnabled){
    const ok = await ensureMic();
    if (ok) toast('Mic on — replay a clip, then speak');
  } else {
    stopTake(true);
    takeAudio.pause();
    if (rec.stream){ rec.stream.getTracks().forEach(t => t.stop()); rec.stream = null; }
  }
  echoUI();
});
$('#echo-status').addEventListener('click', () => { if (rec.recorder) stopTake(false); });
$('#play-orig').addEventListener('click', playOriginalClip);
$('#play-mine').addEventListener('click', playMine);
$('#play-ab').addEventListener('click', () => { abPending = true; playOriginalClip(); });

// review queue
$('#start-review').addEventListener('click', startReview);
$('#queue-skip').addEventListener('click', queueAdvance);
$('#queue-exit').addEventListener('click', exitReview);
(function(){
  const inp = $('#time-a');
  const commit = () => {
    const v = parseTimeStr(inp.value);
    if (v != null) setStart(v);
    else inp.value = state.a != null ? fmtTime(state.a, true) : '';
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ commit(); inp.blur(); } });
})();

$('#replay-btn').addEventListener('click', doReplay);
$('#save-btn').addEventListener('click', openSaveModal);
$('#modal-cancel').addEventListener('click', closeSaveModal);
$('#modal-save').addEventListener('click', saveFromModal);
$('#modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeSaveModal(); });
$('#seg-folder').addEventListener('change', () => {
  const isNew = $('#seg-folder').value === '__new__';
  $('#new-folder-field').classList.toggle('hidden', !isNew);
  if (isNew) setTimeout(() => $('#seg-folder-new').focus(), 30);
});

$('#goal-input').addEventListener('change', () => {
  const v = parseInt($('#goal-input').value, 10);
  if (v >= 1 && v <= 500){ settings.dailyGoal = v; saveSettings(); renderDashboard(); }
  else $('#goal-input').value = settings.dailyGoal;
});
$$('.hm-view').forEach(btn => {
  btn.addEventListener('click', () => {
    state.hmView = btn.dataset.view;
    $$('.hm-view').forEach(b => b.classList.toggle('active', b === btn));
    renderHeatmap();
  });
});
$('#sync-url').addEventListener('change', () => {
  settings.syncUrl = $('#sync-url').value.trim();
  saveSettings();
  updateSyncStatus();
  if (settings.syncUrl) syncNow(false);
});
$('#sync-now').addEventListener('click', () => syncNow(false));

$('#export-btn').addEventListener('click', exportData);
$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { importData(JSON.parse(reader.result)); }
    catch (err) { toast('Could not read the file: not valid JSON'); }
  };
  reader.readAsText(f);
  e.target.value = '';
});

/* ---------------- keyboard shortcuts (desktop) ---------------- */
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if ($('#view-practice').classList.contains('hidden')) return;

  const k = e.key;
  if (k === ' '){
    e.preventDefault();
    if (playerReady){
      try {
        if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
        else player.playVideo();
      } catch (err) {}
    }
  } else if (k === 'r' || k === 'R' || k === 'Enter'){
    e.preventDefault(); doReplay();
  } else if (k === 'j' || k === 'J'){
    e.preventDefault(); seekRelative(-10);
  } else if (k === 'l' || k === 'L'){
    e.preventDefault(); seekRelative(10);
  } else if (k === 'k' || k === 'K'){
    e.preventDefault();
    if (playerReady){
      try {
        if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
        else player.playVideo();
      } catch (err) {}
    }
  } else if (k === 'ArrowLeft' || k === 'ArrowRight'){
    e.preventDefault();
    const step = (e.shiftKey ? 1 : 0.5) * (k === 'ArrowLeft' ? -1 : 1);
    nudgeStart(step);
  } else if (k === '-' || k === '_'){
    e.preventDefault(); changeLen(-0.5);
  } else if (k === '=' || k === '+'){
    e.preventDefault(); changeLen(0.5);
  }
});

/* ---------------- URL params (no-backend share) ---------------- */
function bootFromParams(){
  const q = new URLSearchParams(location.search);
  const v = q.get('v');
  if (!v || !/^[A-Za-z0-9_-]{11}$/.test(v)) return false;
  const a = parseFloat(q.get('a'));
  const b = parseFloat(q.get('b'));
  const label = q.get('label') || '';
  showView('practice');
  loadVideo(v, isNaN(a) ? 0 : Math.max(0, a - 0.5));
  if (!isNaN(a)) state.a = round1(a);
  if (!isNaN(b) && !isNaN(a)) state.len = clamp(round1(b - a), LEN_MIN, LEN_MAX);
  recomputeB();
  state.currentSegmentId = findMatchingSegmentId();
  updateAll();
  if (!state.currentSegmentId && state.a != null && state.b != null){
    toast('Loaded a shared clip', { action: { label: 'Save clip', fn: openSaveModal }, duration: 10000 });
  }
  history.replaceState(null, '', location.pathname);
  return true;
}

/* ---------------- boot ---------------- */
updateAll();
echoUI();
$('#sync-url').value = settings.syncUrl || '';
updateSyncStatus();
if (!bootFromParams()) showView('home');
if (settings.syncUrl) syncNow(true);

if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
