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
    lastFolder: '', syncUrl: '', lastSyncAt: 0, micEnabled: false, name: 'Eric' },
  lsLoad(LS.set, {})
);
// migrate older segments: ensure folder + len + spaced-repetition fields
function migrateSegment(s){
  if (s.folder == null) s.folder = 'Uncategorized';
  if (s.len == null && s.a != null && s.b != null) s.len = round1(s.b - s.a);
  if (s.srsLevel == null) s.srsLevel = 0;
  // strip the old auto-generated "0:32 (2.0s)" tail from labels — the list
  // shows timestamp + length on their own now, so the name stays clean
  if (s.label){
    const m = /^(.*?)\s*\d{1,3}:\d{2}(?::\d{2})?\s*\(\d+\.\d+s\)\s*$/.exec(s.label);
    if (m) s.label = m[1].trim() || s.title || 'Clip';
  }
  // a clip enters the review rotation only after its first practice,
  // so saving a big batch doesn't flood tomorrow's queue
  if (!s.lastPracticedAt){
    s.dueDate = null;
  } else if (s.dueDate == null){
    const d = new Date(s.lastPracticedAt); d.setDate(d.getDate() + 1);
    s.dueDate = dateStr(d);
  }
}
segments.forEach(migrateSegment);
lsSave(LS.seg, segments);      // persist migrations (cleaned labels, dueDate) locally

let applyingRemote = false;   // true while merging cloud data, to avoid sync feedback loops
const saveSegments = () => { lsSave(LS.seg, segments); if (!applyingRemote) scheduleSync(); };
const saveLogs     = () => { lsSave(LS.log, logs);     if (!applyingRemote) scheduleSync(); };
const saveSettings = () => lsSave(LS.set, settings);

const DEFAULT_FOLDER = 'Uncategorized';

/* ---------------- app state ---------------- */
const state = {
  videoId: null,
  audioUrl: null,              // set instead of videoId for podcast/mp3 sources
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
  clipSort: 'recent',          // recent | stale | reps | name
  adjustOpen: false,           // fine-tune panel expanded
  hmView: 'm1',                // m1 | m3 | y1
  pendingVideo: null,          // {videoId, start} waiting for API ready
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

/* ---------------- media facade (YouTube video OR podcast audio) ----------------
   Both sources drive the same clip / replay / rep machinery through these
   wrappers, so the rest of the app never has to branch on which is playing. */
let mediaKind = 'yt';            // 'yt' | 'audio'
let audioEl = null;              // the <audio> element when mediaKind === 'audio'
let audioPendingSeek = null;     // seek to apply once the audio's duration is known

function hasSource(){ return !!(state.videoId || state.audioUrl); }

function mediaPlaying(){
  if (mediaKind === 'audio') return !!audioEl && !audioEl.paused && !audioEl.ended;
  try { const s = player.getPlayerState(); return s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING; }
  catch (e) { return false; }
}
function mediaTime(){
  if (mediaKind === 'audio') return audioEl ? audioEl.currentTime : 0;
  try { return player.getCurrentTime(); } catch (e) { return 0; }
}
function mediaSeek(t){
  t = Math.max(0, t);
  if (mediaKind === 'audio'){ if (audioEl) audioEl.currentTime = t; return; }
  try { player.seekTo(t, true); } catch (e) {}
}
function mediaPlay(){
  if (mediaKind === 'audio'){ if (audioEl) audioEl.play().catch(() => {}); return; }
  try { player.playVideo(); } catch (e) {}
}
function mediaPause(){
  if (mediaKind === 'audio'){ if (audioEl) audioEl.pause(); return; }
  try { player.pauseVideo(); } catch (e) {}
}
function mediaSetRate(r){
  if (mediaKind === 'audio'){ if (audioEl) audioEl.playbackRate = r; return; }
  try { player.setPlaybackRate(r); } catch (e) {}
}

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
  // disablekb: turn off YouTube's own keyboard (its J/L jump 10s) so our
  // J/L (1s) is the only thing that answers those keys
  const pv = { playsinline: 1, rel: 0, controls: 1, disablekb: 1, start: Math.floor(start || 0) };
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
  cancelMark();
  mediaKind = 'yt';
  if (audioEl){ try { audioEl.pause(); } catch (e) {} }
  state.audioUrl = null;
  state.videoId = videoId;
  state.url = 'https://www.youtube.com/watch?v=' + videoId;
  state.title = '';
  state.duration = 0;
  setMediaMode('yt');
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

/* ---------------- podcast / mp3 audio source ---------------- */
function setMediaMode(kind){
  const wrap = $('#player-wrap');
  if (wrap) wrap.classList.toggle('audio-mode', kind === 'audio');
  if (audioEl) audioEl.classList.toggle('hidden', kind !== 'audio');
  const frame = $('#player');
  if (frame) frame.classList.toggle('hidden', kind === 'audio');
}
function ensureAudioEl(){
  if (audioEl) return audioEl;
  audioEl = document.createElement('audio');
  audioEl.id = 'audio-el';
  audioEl.className = 'audio-player hidden';
  audioEl.controls = true;
  audioEl.preload = 'metadata';
  audioEl.setAttribute('playsinline', '');
  const wrap = $('#player-wrap');
  wrap.insertBefore(audioEl, $('#player-placeholder'));

  const setDur = () => { if (isFinite(audioEl.duration) && audioEl.duration > 0) state.duration = audioEl.duration; };
  audioEl.addEventListener('loadedmetadata', () => {
    setDur();
    playerReady = true;
    if (audioPendingSeek != null){ audioEl.currentTime = Math.max(0, audioPendingSeek); audioPendingSeek = null; }
    updateAll();
  });
  audioEl.addEventListener('durationchange', setDur);
  audioEl.addEventListener('playing', () => { if (mediaKind === 'audio') onMediaPlaying(); });
  audioEl.addEventListener('pause',   () => { if (mediaKind === 'audio') onMediaPaused(); });
  audioEl.addEventListener('waiting', () => { if (mediaKind === 'audio') onMediaBuffering(); });
  audioEl.addEventListener('ended',   () => { if (mediaKind === 'audio') onMediaEnded(); });
  audioEl.addEventListener('error',   () => {
    if (mediaKind !== 'audio') return;
    playerReady = false;
    toast("Couldn't load that audio — use a direct .mp3 link, not a web page", { duration: 7000 });
  });
  return audioEl;
}
function loadAudio(url, start = 0){
  cancelMark();
  mediaKind = 'audio';
  try { if (player) player.pauseVideo(); } catch (e) {}   // silence any YouTube video
  state.videoId = null;
  state.audioUrl = url;
  state.url = url;
  state.title = 'Audio track';
  state.duration = 0;
  playerReady = false;
  audioPendingSeek = start || 0;
  ensureAudioEl();
  setMediaMode('audio');
  $('#player-placeholder').classList.add('hidden');
  $('#video-title').textContent = '🎧 Audio track';
  audioEl.src = url;
  audioEl.load();
  updateAll();
}

function onPlayerReady(){
  playerReady = true;
  refreshVideoMeta();
  updateAll();
}
function refreshVideoMeta(){
  if (mediaKind === 'audio') return;
  if (!player || !playerReady) return;
  try {
    const d = player.getDuration();
    if (d && d > 0) state.duration = d;
    const vd = player.getVideoData && player.getVideoData();
    if (vd && vd.title){ state.title = vd.title; $('#video-title').textContent = vd.title; }
  } catch (e) {}
}

/* Both YouTube and <audio> feed these shared transitions. YouTube dispatches
   through onPlayerStateChange; the audio element wires its events straight in. */
function onMediaPlaying(){
  // resuming from pause: paused > 10s invalidates this rep
  if (rep.armed && rep.pauseStart != null){
    if (performance.now() - rep.pauseStart > 10000) invalidateRep();
    rep.pauseStart = null;
  }
  rep.lastT = null; rep.lastWall = null;    // reset baseline so pause/buffer isn't mistaken for a seek
  stopPausedPoll();
  startPoll();
  if (rep.armed) setPlayVisual('playing');
  else if (!rep.preview) setPlayVisual('watching');   // free playback: main button becomes tap-to-mark
}
function onMediaPaused(){
  if (rep.armed) rep.pauseStart = performance.now();
  rep.lastT = null; rep.lastWall = null;
  stopPoll();
  // 1a: capture the current time as the clip start on a manual pause,
  // unless this pause was programmatic (preview end / replay finished).
  if (!rep.armed && !rep.preview && !programmaticPause){
    if (mark.pending) finishMarkAtPause();   // pausing mid-mark: the pause is the end
    else captureStartFromPlayer();
  }
  programmaticPause = false;
  // while paused, keep watching the playhead: seeking on the paused
  // timeline moves the clip start along with it
  startPausedPoll();
  if (!rep.armed && document.body.dataset.playstate !== 'waiting') setPlayVisual('idle');
}
function onMediaBuffering(){
  rep.lastT = null; rep.lastWall = null;    // buffering time isn't counted and isn't a seek
  stopPausedPoll();
}
function onMediaEnded(){
  stopPoll();
  stopPausedPoll();
  cancelMark();
  if (rep.armed && state.b != null && state.duration && state.b >= state.duration - 0.6){
    handleReachB();
  } else {
    disarmRep();
    setPlayVisual('idle');
  }
}

function onPlayerStateChange(ev){
  const S = YT.PlayerState;
  refreshVideoMeta();
  if (ev.data === S.PLAYING) onMediaPlaying();
  else if (ev.data === S.PAUSED) onMediaPaused();
  else if (ev.data === S.BUFFERING) onMediaBuffering();
  else if (ev.data === S.ENDED) onMediaEnded();
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
  pausedLastT = mediaTime();
  pausedPollTimer = setInterval(pausedTick, 300);
}
function stopPausedPoll(){
  if (pausedPollTimer){ clearInterval(pausedPollTimer); pausedPollTimer = null; }
  pausedLastT = null;
}
function pausedTick(){
  if (!playerReady) return;
  if (mediaPlaying()) return;
  const t = mediaTime();
  if (pausedLastT != null && Math.abs(t - pausedLastT) > 0.25){
    setStart(t);
    if (document.body.dataset.playstate === 'waiting') setPlayVisual('idle');
  }
  pausedLastT = t;
  renderStripPlayhead();
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
  if (!playerReady) return;
  const t = mediaTime();
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
      mediaPause();
      setPlayVisual('idle');
      if (abPending){ abPending = false; playMine(); }
    }
  }
  else if (rep.armed && state.b != null && t >= state.b - 0.05){
    handleReachB();
  }

  renderStripPlayhead();
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
  mediaPause();
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
  // the list shows the timestamp + length separately, so the name stays clean
  return state.title || 'Clip';
}

function makeSegment(fields = {}){
  return Object.assign({
    schemaVersion: 2,
    id: uuid(),
    videoId: state.videoId,
    audioUrl: state.audioUrl,         // set instead of videoId for mp3/podcast clips
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
    dueDate: null,                    // enters the review rotation after its first practice
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

  if (before < settings.dailyGoal && before + 1 >= settings.dailyGoal){
    const st = computeStreak();
    toast('🎉 Daily goal reached! ' + st.streak + '-day streak');
  }
  renderDashboard();
}

/* ---------------- playback actions ---------------- */
function doReplay(){
  if (!playerReady || !hasSource()){ toast('Load a video or audio track first'); return; }
  if (state.a == null || state.b == null || state.b <= state.a){
    toast('Mark a start point first'); return;
  }
  cancelMark();
  takeAudio.pause();
  abPending = false;
  if (rec.recorder) stopTake(false);
  if (settings.micEnabled) ensureMic();   // warm the mic up so recording can start at the pause
  armRep();
  mediaSetRate(1);
  mediaSeek(state.a);
  mediaPlay();
  setPlayVisual('playing');
}

/* ---------------- tap-to-mark: set the clip by ear ----------------
   While the video plays freely, the main button turns into a marker:
   tap when the line starts, tap again when it ends. No timeline needed. */
const mark = { pending: false };
const MARK_REACTION = 0.35;   // people tap about a beat after the line begins

function markStart(){
  if (!playerReady) return;
  const t = mediaTime();
  mark.pending = true;
  state.currentSegmentId = null;    // tapping ⏺ starts a fresh clip, not an edit of the open one
  setStart(Math.max(0, t - MARK_REACTION));
}
function markEnd(){
  const t = mediaTime();
  mark.pending = false;
  setLen(round1(t - 0.1) - state.a);
  toast('Clip set — listen, then hit Replay');
  playOriginalClip();          // jump back and audition what you marked
  setPlayVisual('idle');
}
function cancelMark(){
  if (!mark.pending) return;
  mark.pending = false;
  updateRepButton(false);
}
function finishMarkAtPause(){
  const t = mediaTime();
  mark.pending = false;
  if (state.a != null && t > state.a + LEN_MIN){
    setLen(round1(t) - state.a);   // the pause point is the end
  } else {
    captureStartFromPlayer();      // paused too soon — fall back to pause-capture
  }
  updateRepButton(false);
}
function onMainButton(){
  if (document.body.dataset.playstate === 'watching'){
    if (mark.pending) markEnd();
    else markStart();
    return;
  }
  doReplay();
}

/* ---------------- audition: every adjustment plays the new edge ----------------
   You can't see sound, so each start/end change answers with your ears:
   a short snippet plays at the boundary you just moved. */
let auditionTimer = null;
function scheduleAudition(edge){          // 'a' = start, 'b' = end
  if (!playerReady || state.a == null || state.b == null) return;
  if (rep.armed) return;
  clearTimeout(auditionTimer);
  auditionTimer = setTimeout(() => { auditionTimer = null; auditionEdge(edge); }, 350);
}
function auditionEdge(edge){
  if (!playerReady || state.a == null || state.b == null) return;
  cancelMark();
  takeAudio.pause();
  disarmRep();
  const from = edge === 'b' ? Math.max(state.a, state.b - 0.8) : state.a;
  const to   = edge === 'b' ? state.b : Math.min(state.b, state.a + 0.8);
  rep.preview = { end: to };
  mediaSetRate(1);
  mediaSeek(from);
  mediaPlay();
}

function setPlayVisual(mode){
  document.body.dataset.playstate = mode;
  updateRepButton(false);
}

function seekRelative(delta){
  if (!playerReady || !hasSource()){ toast('Load a video or audio track first'); return; }
  const t = mediaTime();
  const playing = mediaPlaying();
  if (rep.armed) disarmRep();
  rep.preview = null;
  cancelMark();
  const target = clamp(round1(t + delta), 0, state.duration || 36000);
  mediaSeek(target);
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
  const mt = $('#mic-toggle');
  mt.classList.toggle('on', !!settings.micEnabled);
  mt.setAttribute('aria-checked', String(!!settings.micEnabled));
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
  if (playerReady && mediaPlaying()){
    programmaticPause = true;
    mediaPause();
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
  cancelMark();
  takeAudio.pause();
  if (rec.recorder) stopTake(false);
  disarmRep();
  rep.preview = { end: state.b };
  mediaSetRate(1);
  mediaSeek(state.a);
  mediaPlay();
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
  refreshCurrentSegment();
  updateAll();
}
function captureStartFromPlayer(){
  if (!playerReady) return;
  setStart(round1(mediaTime()));
}
function nudgeStart(delta){
  if (state.a == null){ toast('Pause the video at a start point first'); return; }
  setStart(state.a + delta);
}
function setLen(val){
  state.len = clamp(round1(val), LEN_MIN, LEN_MAX);
  settings.defaultLen = state.len; saveSettings();
  recomputeB();
  refreshCurrentSegment();
  updateAll();
}
function changeLen(delta){ setLen(state.len + delta); }

function sameSource(seg){
  if (state.videoId) return seg.videoId === state.videoId;
  if (state.audioUrl) return seg.audioUrl === state.audioUrl;
  return false;
}
function findMatchingSegmentId(){
  if (state.a == null || state.b == null || !hasSource()) return null;
  const seg = segments.find(s =>
    sameSource(s) &&
    Math.abs(s.a - state.a) < 0.35 && Math.abs(s.b - state.b) < 0.35);
  return seg ? seg.id : null;
}
// Keep an open clip attached through fine re-trims (so adjusting overwrites it
// instead of saving a copy) as long as the edited range still overlaps it.
// Once it no longer overlaps — the user scrubbed off to mark a different line —
// let go, so we don't count reps on, or overwrite, the clip they just saved.
function refreshCurrentSegment(){
  const cur = state.currentSegmentId ? segments.find(s => s.id === state.currentSegmentId) : null;
  if (cur && state.a != null && state.b != null && state.b > cur.a && state.a < cur.b) return;
  state.currentSegmentId = findMatchingSegmentId();
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

/* ---------------- clip strip (visual timeline) ----------------
   A zoomed window around the clip (not the whole video, which would make
   a 2s clip invisible). Drag the body to move the clip, the edges to trim. */
const strip = { win: null };
let stripDrag = null;

function stripWindow(){
  const len = state.len || 2;
  const w = Math.max(12, len * 3);              // window ≥ 12s so handles stay grabbable
  const center = state.a + len / 2;
  const dur = state.duration || state.a + len + 60;
  let t0 = center - w / 2, t1 = center + w / 2;
  if (t0 < 0){ t1 -= t0; t0 = 0; }
  if (t1 > dur){ t0 = Math.max(0, t0 - (t1 - dur)); t1 = dur; }
  return { t0, t1 };
}

function renderStrip(){
  const el = $('#clip-strip');
  const show = state.a != null && state.b != null;
  el.classList.toggle('hidden', !show);
  if (!show){ strip.win = null; return; }
  if (!stripDrag) strip.win = stripWindow();    // freeze the window while dragging
  const { t0, t1 } = strip.win;
  const pct = t => clamp((t - t0) / (t1 - t0) * 100, 0, 100);
  const range = $('#strip-range');
  const left = pct(state.a);
  range.style.left = left + '%';
  range.style.width = Math.max(0, pct(state.b) - left) + '%';
  $('#strip-t0').textContent = fmtTime(t0);
  $('#strip-t1').textContent = fmtTime(t1);
  renderStripPlayhead();
}

function renderStripPlayhead(){
  const ph = $('#strip-playhead');
  if (!strip.win || !playerReady){ ph.classList.add('hidden'); return; }
  const t = mediaTime();
  const { t0, t1 } = strip.win;
  if (t == null || isNaN(t) || t < t0 || t > t1){ ph.classList.add('hidden'); return; }
  ph.classList.remove('hidden');
  ph.style.left = ((t - t0) / (t1 - t0) * 100) + '%';
}

function applyStripDrag(t){
  if (!stripDrag) return;
  if (stripDrag.mode === 'a'){
    // left edge: trim/extend the head, keeping the end where it is
    const b = state.b;
    const a = clamp(round1(t), Math.max(0, round1(b - LEN_MAX)), round1(b - LEN_MIN));
    state.a = a;
    state.len = round1(b - a);
    settings.defaultLen = state.len; saveSettings();
    recomputeB();
    refreshCurrentSegment();
    updateAll();
  } else if (stripDrag.mode === 'b'){
    setLen(t - state.a);
  } else {
    setStart(t - stripDrag.offset);
  }
}

(function(){
  const track = $('#strip-track');
  const timeAt = clientX => {
    const r = track.getBoundingClientRect();
    const { t0, t1 } = strip.win;
    return t0 + clamp((clientX - r.left) / r.width, 0, 1) * (t1 - t0);
  };
  track.addEventListener('pointerdown', e => {
    if (state.a == null || !strip.win) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    disarmRep();
    rep.preview = null;
    cancelMark();
    if (document.body.dataset.playstate === 'waiting') setPlayVisual('idle');
    const t = timeAt(e.clientX);
    const h = e.target.dataset ? e.target.dataset.h : null;
    if (h === 'a' || h === 'b') stripDrag = { mode: h };
    else if (e.target.closest('#strip-range')) stripDrag = { mode: 'move', offset: t - state.a };
    else stripDrag = { mode: 'move', offset: state.len / 2 };   // tap empty track: center the clip there
    applyStripDrag(t);
    try { track.setPointerCapture(e.pointerId); } catch (err) {}
  });
  track.addEventListener('pointermove', e => { if (stripDrag) applyStripDrag(timeAt(e.clientX)); });
  const end = () => {
    if (!stripDrag) return;
    const edge = stripDrag.mode === 'b' ? 'b' : 'a';
    stripDrag = null;
    renderStrip();            // re-center the window now that the drag is done
    scheduleAudition(edge);   // and let the ear check the new boundary
  };
  ['pointerup', 'pointercancel'].forEach(ev => track.addEventListener(ev, end));
})();

/* ---------------- UI sync ---------------- */
function renderClipSummary(){
  const has = state.a != null && state.b != null;
  $('#adjust-panel').classList.toggle('hidden', !has);   // panel is always visible once a clip exists
}
/* A boundary moved — pop the read-out and ping its handle on the strip,
   so a change you didn't type is still noticed. */
const shown = { a: null, b: null, len: null };
function flick(el, cls){
  if (!el) return;
  el.classList.remove('bump', 'ping');
  void el.offsetWidth;                     // restart the animation mid-flight
  el.classList.add(cls);
}
function pulseEdges(){
  if (stripDrag){                          // dragging already shows the movement
    shown.a = state.a; shown.b = state.b; shown.len = state.len;
    return;
  }
  const seen = shown.a != null && shown.b != null;
  const moved = k => state.a != null && seen && Math.abs(state[k] - shown[k]) > 0.001;
  if (moved('a') && document.activeElement !== $('#time-a')){
    flick($('#time-a'), 'bump');
    flick($('.strip-handle[data-h="a"]'), 'ping');
  }
  if (moved('b') && document.activeElement !== $('#time-b')){
    flick($('#time-b'), 'bump');
    flick($('.strip-handle[data-h="b"]'), 'ping');
  }
  shown.a = state.a; shown.b = state.b; shown.len = state.len;
}

function updateAll(){
  $('#time-a').value = state.a != null ? fmtTime(state.a, true) : '';
  $('#time-b').value = state.b != null ? fmtTime(state.b, true) : '';
  $('#len-val').textContent = state.len.toFixed(1) + 's';
  pulseEdges();
  $('#clip-unset-hint').classList.toggle('hidden', state.a != null);
  renderClipSummary();
  renderStrip();
  updateRepButton(false);
}
function updateRepButton(bump){
  const btn = $('#replay-btn');
  const ready = playerReady && state.a != null && state.b != null && state.b > state.a;
  const saved = !!state.currentSegmentId;
  const wrap = $('#rep-count');
  const watching = document.body.dataset.playstate === 'watching';
  btn.classList.toggle('watch', watching);
  btn.classList.toggle('marking', watching && mark.pending);
  if (watching){
    // free playback: the main button marks the clip by ear
    btn.disabled = false;
    $('.replay-icon').textContent = mark.pending ? '⏹' : '⏺';
    $('#replay-label').textContent = mark.pending ? 'Line ends — tap' : 'Line starts — tap';
    wrap.classList.add('hidden');
  } else {
    btn.disabled = !ready;
    $('.replay-icon').textContent = '▶';
    $('#replay-label').textContent = saved ? 'Replay' : (ready ? 'Replay (unsaved)' : 'Replay');
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
  const save = $('#save-btn');
  save.classList.toggle('accent', ready && !saved && !watching);
  save.textContent = saved ? 'Update' : 'Save';
  save.title = saved ? 'Update this clip' : 'Save clip — reps only count for saved clips';
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
  if (state.a == null || state.b == null || !hasSource()){
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
  // new clips default to the folder used on the previous save
  const preferred = seg ? (seg.folder || DEFAULT_FOLDER)
                        : (settings.lastFolder || state.folderFilter || DEFAULT_FOLDER);
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
  settings.lastFolder = folder; saveSettings();
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
  saveSegments();
  renderDashboard();
  renderSegmentList();
  toast('Deleted');
}

function loadSegment(id){
  const seg = segments.find(s => s.id === id);
  if (!seg) return;
  cancelMark();
  showView('practice');
  loadTakeFor(seg.id);
  const apply = () => {
    state.a = seg.a; state.b = seg.b;
    state.len = seg.len != null ? seg.len : round1(seg.b - seg.a);
    state.currentSegmentId = seg.id;
    updateAll();
  };
  const isAudio = !!seg.audioUrl;
  const already = isAudio ? (state.audioUrl === seg.audioUrl) : (state.videoId === seg.videoId);
  if (!already){
    if (isAudio) loadAudio(seg.audioUrl, Math.max(0, seg.a - 0.5));
    else loadVideo(seg.videoId, Math.max(0, seg.a - 0.5));
    apply();
  } else {
    apply();
    if (playerReady){ mediaSeek(seg.a); mediaPause(); }
  }
}

function shareSegment(seg){
  const u = new URL(location.origin + location.pathname);
  if (seg.audioUrl) u.searchParams.set('au', seg.audioUrl);
  else u.searchParams.set('v', seg.videoId);
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
  const counts = {}, last = {};
  segments.forEach(s => {
    const f = s.folder || DEFAULT_FOLDER;
    counts[f] = (counts[f] || 0) + 1;
    last[f]   = Math.max(last[f] || 0, s.lastPracticedAt || s.createdAt || 0);
  });
  return { counts, last };
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
    if (sort === 'name')  return (x.label || '').localeCompare(y.label || '');
    if (sort === 'reps')  return (y.reps || 0) - (x.reps || 0);
    if (sort === 'stale') return (x.lastPracticedAt || 0) - (y.lastPracticedAt || 0);  // never practiced first
    return (y.lastPracticedAt || y.createdAt) - (x.lastPracticedAt || x.createdAt);    // recent
  });
  return arr;
}

/* practice status of a clip, for the at-a-glance rep tally colour */
function segStatus(seg){
  if (segTodayReps(seg.id) > 0) return 'done';   // touched today
  if (!seg.lastPracticedAt) return 'new';        // never practiced
  return 'ok';                                   // practiced before
}
const STATUS_TITLE = {
  done: 'Practiced today',
  new: 'Not practiced yet',
  ok: 'Practiced before',
};

/* move a clip to another folder (from the inline folder chip) */
function moveSegment(id, folder){
  const seg = segments.find(s => s.id === id);
  if (!seg || (seg.folder || DEFAULT_FOLDER) === folder) return;
  seg.folder = folder;
  settings.lastFolder = folder; saveSettings();
  saveSegments();
  renderSegmentList();
  toast('Moved to “' + folder + '”');
}

function segDisplayName(seg){
  return (seg.note && seg.note.trim()) || seg.label || seg.title || 'this clip';
}

/* zero a clip's rep count only — practice history, SRS schedule and the
   heatmap/streak are all kept */
function resetSegmentReps(id){
  const seg = segments.find(s => s.id === id);
  if (!seg) return;
  if (!seg.reps){ toast('Already at 0 reps'); return; }
  const name = segDisplayName(seg);
  if (!confirm('Reset reps for “' + name.slice(0, 40) + '” to 0? Your schedule and streak stay intact.')) return;
  seg.reps = 0;
  saveSegments();
  renderSegmentList();
  renderDashboard();
  toast('Reps reset to 0');
}

let folderMenuEl = null;
function closeFolderMenu(){
  if (!folderMenuEl) return;
  folderMenuEl.remove(); folderMenuEl = null;
  document.removeEventListener('click', onDocClickFolderMenu, true);
  window.removeEventListener('resize', closeFolderMenu);
}
function onDocClickFolderMenu(e){ if (folderMenuEl && !folderMenuEl.contains(e.target)) closeFolderMenu(); }
function openFolderMenu(seg, anchor){
  const open = folderMenuEl;
  closeFolderMenu();
  if (open && open.dataset.seg === seg.id) return;   // clicking the same chip toggles it closed
  const menu = document.createElement('div');
  menu.className = 'folder-menu';
  menu.dataset.seg = seg.id;
  const cur = seg.folder || DEFAULT_FOLDER;
  allFolders().forEach(name => {
    const b = document.createElement('button');
    b.className = 'fm-item' + (name === cur ? ' current' : '');
    b.textContent = name;
    b.addEventListener('click', e => { e.stopPropagation(); closeFolderMenu(); moveSegment(seg.id, name); });
    menu.appendChild(b);
  });
  const nw = document.createElement('button');
  nw.className = 'fm-item fm-new';
  nw.textContent = '＋ New folder…';
  nw.addEventListener('click', e => {
    e.stopPropagation();
    closeFolderMenu();
    const name = (prompt('New folder name') || '').trim();
    if (name){ ensureFolder(name); moveSegment(seg.id, name); }
  });
  menu.appendChild(nw);

  const rz = document.createElement('button');
  rz.className = 'fm-item fm-reset';
  rz.textContent = '↺ Reset reps';
  rz.addEventListener('click', e => { e.stopPropagation(); closeFolderMenu(); resetSegmentReps(seg.id); });
  menu.appendChild(rz);

  const del = document.createElement('button');
  del.className = 'fm-item fm-del';
  del.textContent = '🗑 Delete clip';
  del.addEventListener('click', e => { e.stopPropagation(); closeFolderMenu(); deleteSegment(seg.id); });
  menu.appendChild(del);

  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const maxLeft = document.documentElement.clientWidth - menu.offsetWidth - 8;
  menu.style.top  = (r.bottom + window.scrollY + 4) + 'px';
  menu.style.left = Math.max(8, Math.min(r.left + window.scrollX, maxLeft + window.scrollX)) + 'px';
  folderMenuEl = menu;
  setTimeout(() => {
    document.addEventListener('click', onDocClickFolderMenu, true);
    window.addEventListener('resize', closeFolderMenu);
  }, 0);
}

function renderSegmentList(){
  closeFolderMenu();
  const stats = folderStats();

  // ---- folders pane ----
  const fl = $('#folder-list');
  if (fl){
    fl.innerHTML = '';
    const mkRow = (label, value, count) => {
      const li = document.createElement('li');
      li.className = 'folder-row' + (state.folderFilter === value ? ' active' : '');
      li.innerHTML =
        '<span class="fr-name">' + escapeHtml(label) + '</span>' +
        '<span class="fr-meta">' + count + '</span>';
      li.addEventListener('click', () => { state.folderFilter = value; renderSegmentList(); });
      fl.appendChild(li);
    };
    mkRow('All', null, segments.length);
    orderedFolders(stats).forEach(name =>
      mkRow(name, name, stats.counts[name] || 0));
  }

  // ---- clips pane ----
  let list = segments.slice();
  if (state.folderFilter) list = list.filter(s => (s.folder || DEFAULT_FOLDER) === state.folderFilter);

  list = sortedClips(list);

  const titleEl = $('#clips-pane-title');
  if (titleEl) titleEl.textContent = state.folderFilter || 'All clips';

  const ul = $('#segment-list');
  ul.innerHTML = '';
  const empty = $('#segment-list-empty');
  empty.classList.toggle('hidden', list.length > 0);
  empty.textContent = 'No clips here yet. Load a video, set a start, then hit Save.';

  list.forEach(seg => {
    const st = segStatus(seg);
    const li = document.createElement('li');
    li.className = 'seg-item';
    li.setAttribute('role', 'button');
    li.tabIndex = 0;
    li.title = 'Practice this clip';
    const folder = seg.folder || DEFAULT_FOLDER;
    const len = seg.len != null ? seg.len : round1(seg.b - seg.a);
    // headline is the note — the line you're shadowing — falling back to the name
    const headline = (seg.note && seg.note.trim()) || seg.label || seg.title || 'Clip';
    // meta: source name · timestamp · length
    const meta = [escapeHtml(seg.title || seg.videoId || 'Audio'), fmtTime(seg.a), len.toFixed(1) + 's'].join(' · ');
    const tUrl = thumbUrl(seg.videoId);
    const thumbHtml = tUrl
      ? '<img class="seg-thumb" src="' + tUrl + '" alt="">'
      : '<div class="seg-thumb seg-thumb-audio" aria-hidden="true">🎧</div>';
    li.innerHTML =
      thumbHtml +
      '<div class="seg-info">' +
        '<div class="seg-label">' + escapeHtml(headline) + '</div>' +
        '<div class="seg-meta">' + meta + '</div>' +
        '<div class="seg-folder-line">' +
          '<button class="seg-folder-btn" title="Move to another folder or delete" aria-label="Folder and clip actions">' +
            '<span class="fb-name">' + escapeHtml(folder) + '</span> ⌄</button>' +
        '</div>' +
      '</div>' +
      '<div class="seg-reps" data-st="' + st + '" title="' + STATUS_TITLE[st] + ' · practiced ' + seg.reps + (seg.reps === 1 ? ' time' : ' times') + '">' +
        '<b>' + seg.reps + '</b><span>reps</span></div>';
    const thumb = li.querySelector('img.seg-thumb');
    if (thumb) thumb.addEventListener('error', () => { thumb.style.display = 'none'; });
    li.addEventListener('click', () => loadSegment(seg.id));
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); loadSegment(seg.id); } });
    const fbtn = li.querySelector('.seg-folder-btn');
    fbtn.addEventListener('click', e => { e.stopPropagation(); openFolderMenu(seg, fbtn); });
    ul.appendChild(li);
  });
}

/* ---------------- daily spark ----------------
   One quote per day, picked deterministically from the date so it
   stays the same all day and changes tomorrow. */
const QUOTES = [
  { t: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', a: 'Will Durant' },
  { t: 'Repetition is the mother of learning.', a: 'Russian proverb' },
  { t: 'Little by little, a little becomes a lot.', a: 'Tanzanian proverb' },
  { t: 'The limits of my language mean the limits of my world.', a: 'Ludwig Wittgenstein' },
  { t: 'To have another language is to possess a second soul.', a: 'Charlemagne' },
  { t: 'A different language is a different vision of life.', a: 'Federico Fellini' },
  { t: 'Success is the sum of small efforts, repeated day in and day out.', a: 'Robert Collier' },
  { t: "You don't have to be great to start, but you have to start to be great.", a: 'Zig Ziglar' },
  { t: 'The expert in anything was once a beginner.', a: 'Helen Hayes' },
  { t: "Don't watch the clock; do what it does. Keep going.", a: 'Sam Levenson' },
  { t: "It always seems impossible until it's done.", a: 'Nelson Mandela' },
  { t: 'Motivation is what gets you started. Habit is what keeps you going.', a: 'Jim Ryun' },
  { t: 'The secret of getting ahead is getting started.', a: 'Mark Twain' },
  { t: 'Great things are done by a series of small things brought together.', a: 'Vincent van Gogh' },
  { t: 'Every artist was first an amateur.', a: 'Ralph Waldo Emerson' },
  { t: 'If you talk to a man in a language he understands, that goes to his head. If you talk to him in his language, that goes to his heart.', a: 'Nelson Mandela' },
  { t: 'Learning another language is not only learning different words for the same things, but learning another way to think about things.', a: 'Flora Lewis' },
  { t: 'One language sets you in a corridor for life. Two languages open every door along the way.', a: 'Frank Smith' },
  { t: 'Language is the road map of a culture.', a: 'Rita Mae Brown' },
  { t: 'Do something today that your future self will thank you for.', a: 'Sean Patrick Flanery' },
  { t: 'You are always a student, never a master. You have to keep moving forward.', a: 'Conrad Hall' },
  { t: 'Practice like you have never won. Perform like you have never lost.', a: 'Bernard F. Asuncion' },
  { t: 'Knowledge of languages is the doorway to wisdom.', a: 'Roger Bacon' },
  { t: 'He who knows no foreign languages knows nothing of his own.', a: 'Johann Wolfgang von Goethe' },
  { t: 'The more languages you know, the more you are human.', a: 'Tomáš Garrigue Masaryk' },
  { t: 'Language is the blood of the soul into which thoughts run and out of which they grow.', a: 'Oliver Wendell Holmes' },
  { t: 'You can never understand one language until you understand at least two.', a: 'Geoffrey Willans' },
  { t: 'A new language is a new life.', a: 'Persian proverb' },
  { t: 'Practice is the hardest part of learning, and training is the essence of transformation.', a: 'Ann Voskamp' },
  { t: 'Small daily improvements over time lead to stunning results.', a: 'Robin Sharma' },
  { t: 'It does not matter how slowly you go as long as you do not stop.', a: 'Confucius' },
  { t: 'Quality is not an act, it is a habit.', a: 'Aristotle' },
  { t: 'We first make our habits, and then our habits make us.', a: 'John Dryden' },
  { t: 'Perfection is not attainable, but if we chase perfection we can catch excellence.', a: 'Vince Lombardi' },
  { t: 'The way to get started is to quit talking and begin doing.', a: 'Walt Disney' },
  { t: 'Continuous improvement is better than delayed perfection.', a: 'Mark Twain' },
  { t: 'Fluency is not about knowing every word, but about not being afraid to speak.', a: 'Anonymous' },
  { t: 'A little progress each day adds up to big results.', a: 'Satya Nani' },
  { t: 'Courage is the most important of all the virtues, because without courage you can\'t practice any other virtue consistently.', a: 'Maya Angelou' },
  { t: 'The only way to learn to speak is to speak.', a: 'Anonymous' },
];
function renderQuote(){
  const s = todayStr();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const q = QUOTES[h % QUOTES.length];
  const txt = $('#quote-text');
  txt.textContent = q.t;
  txt.classList.toggle('long', q.t.length > 90);
  $('#quote-author').textContent = '— ' + q.a;
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
  $('#name-input').value = settings.name || '';
  renderGreeting(total, goal);

  const isEmpty = segments.length === 0 && logs.length === 0;
  $('#getting-started').classList.toggle('hidden', !isEmpty);
  $('#progress-section').classList.toggle('hidden', isEmpty);
  if (!isEmpty) renderHeatmap();
  renderQuote();
}

/* ---------------- personalised greeting ----------------
   Time-of-day hello + a progress-aware line, both using the name from
   Settings (blank name simply drops the ", Eric" part). */
function greetingTime(){
  const h = new Date().getHours();
  if (h < 5)  return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function renderGreeting(total, goal){
  const name = (settings.name || '').trim();
  const who = name ? ', ' + name : '';
  $('#hero-greeting').textContent = greetingTime() + who + ' 👋';
  let title;
  if (total <= 0){
    title = 'What are you shadowing today' + who + '?';
  } else if (total < goal){
    const left = goal - total;
    title = left + (left === 1 ? ' rep' : ' reps') + ' to go' + who + ' — keep it rolling';
  } else {
    title = 'Goal done' + who + ' 🎉 every extra rep is a bonus';
  }
  $('#hero-title').textContent = title;
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

async function syncNow(silent, pullOnly){
  const url = settings.syncUrl;
  if (!url){ if (!silent) toast('Paste your Apps Script URL first'); return; }
  if (syncing){ syncQueued = true; return; }
  syncing = true;
  if (!pullOnly) setSyncStatus('Syncing…');
  try {
    const res = await fetch(url);
    const remote = await res.json();
    if (remote && remote.data && Array.isArray(remote.data.segments) && Array.isArray(remote.data.logs)){
      applyingRemote = true;
      try { mergeData(remote.data); } finally { applyingRemote = false; }
    }
    // periodic refresh only pulls; local edits are pushed by the 5s debounce
    // and when leaving the tab, so we skip re-writing the sheet every minute.
    if (!pullOnly){
      const res2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain avoids a CORS preflight
        body: buildSyncPayload(),
      });
      const out = await res2.json();
      if (!out || !out.ok) throw new Error((out && out.error) || 'sync failed');
    }
    settings.lastSyncAt = Date.now(); saveSettings();
    updateSyncStatus();
    if (!silent) toast('Synced ✓');
  } catch (e) {
    if (!pullOnly) setSyncStatus('Sync failed — check the URL and that the deployment allows "Anyone".');
    if (!silent) toast('Sync failed');
  } finally {
    syncing = false;
    if (syncQueued){ syncQueued = false; scheduleSync(); }
  }
}

// push any pending change immediately (used when leaving the tab/app)
function flushSync(){
  if (!settings.syncUrl || !navigator.sendBeacon) return;
  clearTimeout(syncTimer); syncTimer = null;
  try {
    navigator.sendBeacon(settings.syncUrl, new Blob([buildSyncPayload()], { type: 'text/plain;charset=utf-8' }));
  } catch (e) {}
}

// Fully automatic hand-off between devices — no manual button needed:
//   • leaving this device (tab hidden / closed): flush the latest up to the cloud
//   • returning to this device: pull whatever the other device left behind
document.addEventListener('visibilitychange', () => {
  if (!settings.syncUrl) return;
  if (document.visibilityState === 'hidden'){
    if (syncTimer) flushSync();       // only if there are unpushed changes
  } else {
    syncNow(true);                    // returning: grab the newest first
  }
});
window.addEventListener('pagehide', () => { if (syncTimer) flushSync(); });

// While the app stays open and in the foreground, pull the cloud copy every
// 60s so a device you never close still picks up changes from the other one.
setInterval(() => {
  if (settings.syncUrl && document.visibilityState === 'visible' && !syncing){
    syncNow(true, true);   // silent, pull-only
  }
}, 60000);

/* ---------------- view switching ---------------- */
function showView(which){
  $('#view-home').classList.toggle('hidden', which !== 'home');
  $('#view-clips').classList.toggle('hidden', which !== 'clips');
  $('#view-practice').classList.toggle('hidden', which !== 'practice');
  $('#view-settings').classList.toggle('hidden', which !== 'settings');
  $('#nav-home').classList.toggle('active', which === 'home');
  $('#nav-clips').classList.toggle('active', which === 'clips');
  $('#nav-practice').classList.toggle('active', which === 'practice');
  $('#nav-settings').classList.toggle('active', which === 'settings');
  document.body.classList.toggle('on-practice', which === 'practice');
  if (which === 'home') renderDashboard();
  else if (which === 'clips') renderClips();
  else if (which === 'settings') updateSyncStatus();
}

/* ---------------- event wiring ---------------- */
// A direct audio file (.mp3/.m4a…) or a known podcast host, even with the
// tracking query string NPR/Spotify/Podtrac wrap around the real mp3.
function looksLikeAudioUrl(s){
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i.test(s)) return true;
  return /(podtrac|simplecastaudio|megaphone|libsyn|buzzsprout|acast|art19|npr\.org|byspotify|chrt\.fm|swap\.fm|pdst\.fm)/i.test(s);
}
function resetForNewSource(){
  state.a = null; state.b = null; state.currentSegmentId = null;
  clearTake();
  showView('practice');
}
function handleUrlInput(inputEl){
  const raw = inputEl.value.trim();
  const parsed = parseYouTubeUrl(raw);
  if (parsed){
    inputEl.value = '';
    resetForNewSource();
    loadVideo(parsed.videoId, parsed.start);
    return;
  }
  if (looksLikeAudioUrl(raw)){
    inputEl.value = '';
    resetForNewSource();
    loadAudio(raw, 0);
    return;
  }
  toast('Could not read that link — paste a YouTube URL or a direct .mp3 podcast link');
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
$('#nav-settings').addEventListener('click', () => showView('settings'));

// clips sorting
$('#folder-sort').addEventListener('change', e => { state.folderSort = e.target.value; renderSegmentList(); });
$('#clip-sort').addEventListener('change', e => { state.clipSort = e.target.value; renderSegmentList(); });

$$('.nudge').forEach(btn => {
  const d = parseFloat(btn.dataset.d);
  bindHold(btn, () => { nudgeStart(d); scheduleAudition('a'); });
});
$$('.end-nudge').forEach(btn => {
  const d = parseFloat(btn.dataset.d);
  bindHold(btn, () => { changeLen(d); scheduleAudition('b'); });
});
bindHold($('#skip-back'), () => seekRelative(-1));   // hold to keep stepping
bindHold($('#skip-fwd'),  () => seekRelative(1));

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
(function(){
  const inp = $('#time-a');
  const commit = () => {
    const v = parseTimeStr(inp.value);
    if (v != null){ setStart(v); scheduleAudition('a'); }
    else inp.value = state.a != null ? fmtTime(state.a, true) : '';
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ commit(); inp.blur(); } });
})();
(function(){
  const inp = $('#time-b');
  const commit = () => {
    const v = parseTimeStr(inp.value);
    if (v != null && state.a != null && v > state.a){ setLen(v - state.a); scheduleAudition('b'); }
    else inp.value = state.b != null ? fmtTime(state.b, true) : '';
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ commit(); inp.blur(); } });
})();

$('#replay-btn').addEventListener('click', onMainButton);
$('#save-btn').addEventListener('click', openSaveModal);
$('#modal-cancel').addEventListener('click', closeSaveModal);
$('#modal-save').addEventListener('click', saveFromModal);
$('#modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeSaveModal(); });
// ⌘/Ctrl+Enter saves from anywhere in the modal (plain Enter stays a newline
// in the note textarea); Esc closes it
$('#modal-backdrop').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); saveFromModal(); }
  else if (e.key === 'Escape'){ e.preventDefault(); closeSaveModal(); }
});
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
$('#name-input').addEventListener('input', () => {
  settings.name = $('#name-input').value.trim().slice(0, 30);
  saveSettings();
  renderGreeting(todayTotal(), settings.dailyGoal);
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
  if (k === ' ' || k === 'k' || k === 'K'){
    e.preventDefault();
    if (playerReady){ if (mediaPlaying()) mediaPause(); else mediaPlay(); }
  } else if (k === 'r' || k === 'R' || k === 'Enter'){
    e.preventDefault(); doReplay();
  } else if (k === 'j' || k === 'J'){
    e.preventDefault(); seekRelative(e.shiftKey ? -10 : -1);
  } else if (k === 'l' || k === 'L'){
    e.preventDefault(); seekRelative(e.shiftKey ? 10 : 1);
  } else if (k === 'ArrowLeft' || k === 'ArrowRight'){
    e.preventDefault();
    const step = (e.shiftKey ? 1 : 0.5) * (k === 'ArrowLeft' ? -1 : 1);
    nudgeStart(step);
    scheduleAudition('a');
  } else if (k === '-' || k === '_'){
    e.preventDefault(); changeLen(-0.5); scheduleAudition('b');
  } else if (k === '=' || k === '+'){
    e.preventDefault(); changeLen(0.5); scheduleAudition('b');
  }
});

/* Clicking the video moves keyboard focus into YouTube's cross-origin iframe,
   which then swallows every keystroke (and with disablekb its own J/L are off
   too — so keys would do nothing). Pull focus back to our document whenever the
   player grabs it, so the shortcuts above keep firing. */
window.addEventListener('blur', () => {
  const ae = document.activeElement;
  if (ae && ae.tagName === 'IFRAME' && !$('#view-practice').classList.contains('hidden')){
    setTimeout(() => { try { ae.blur(); window.focus(); } catch (e) {} }, 0);
  }
});
function bootFromParams(){
  const q = new URLSearchParams(location.search);
  const v = q.get('v');
  const au = q.get('au');
  const isYt = v && /^[A-Za-z0-9_-]{11}$/.test(v);
  const isAudio = au && looksLikeAudioUrl(au);
  if (!isYt && !isAudio) return false;
  const a = parseFloat(q.get('a'));
  const b = parseFloat(q.get('b'));
  showView('practice');
  const start = isNaN(a) ? 0 : Math.max(0, a - 0.5);
  if (isAudio) loadAudio(au, start);
  else loadVideo(v, start);
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
