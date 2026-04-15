// ── BHB Agent Studio — Renderer ───────────────────────────────────────────
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const APP = {
  settings:      {},          // provider, model
  keys:          {},          // elevenlabs, anthropic, openai
  currentSlotId: null,
  currentSoul:   null,
  voices:        [],
  selectedVoice: null,
  chatHistory:   [],          // { role, content }
  voiceMode:     true,
  assetsReady:   false,
};

// Webview state — declared at top level so loadAnimator can reference it
// before initWebviews() wires up the DOM elements
const WEBVIEWS = {
  animator: { el: null, wcId: null, ready: false },
};

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  APP.keys     = await bhb.keys.load();
  APP.settings = await bhb.settings.load();

  const assetStatus = await bhb.assets.status();
  APP.assetsReady   = assetStatus.downloaded;

  // Show setup if no provider key set
  const hasProviderKey = APP.keys.anthropic || APP.keys.openai;
  if (!hasProviderKey) {
    showSetup();
    return;
  }

  // Download assets if needed
  if (!APP.assetsReady) {
    await runAssetDownload();
  }

  launchApp();
}

// ── Setup Flow ─────────────────────────────────────────────────────────────
function showSetup() {
  document.getElementById('setup-overlay').classList.remove('hidden');
  // Provider toggle
  document.querySelectorAll('#setup-overlay .prov-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#setup-overlay .prov-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const prov = btn.dataset.provider;
      document.getElementById('anthropic-section').classList.toggle('hidden', prov !== 'anthropic');
      document.getElementById('openai-section').classList.toggle('hidden', prov !== 'openai');
      APP.settings.provider = prov;
    });
  });
  document.getElementById('setup-save').addEventListener('click', async () => {
    const keys = {
      anthropic: document.getElementById('setup-anthropic-key').value.trim(),
      openai:    document.getElementById('setup-openai-key').value.trim(),
      elevenlabs: document.getElementById('setup-el-key').value.trim(),
    };
    const prov = document.querySelector('#setup-overlay .prov-btn.active')?.dataset.provider || 'anthropic';
    if (!keys[prov]) { alert(`Please enter your ${prov} API key.`); return; }
    APP.keys     = keys;
    APP.settings = { ...APP.settings, provider: prov };
    await bhb.keys.save(keys);
    await bhb.settings.save(APP.settings);
    document.getElementById('setup-overlay').classList.add('hidden');
    if (!APP.assetsReady) await runAssetDownload();
    launchApp();
  });
}

// ── Asset Download ─────────────────────────────────────────────────────────
async function runAssetDownload() {
  const overlay = document.getElementById('asset-overlay');
  const fill    = document.getElementById('asset-progress-fill');
  const label   = document.getElementById('asset-progress-label');
  overlay.classList.remove('hidden');

  bhb.assets.onProgress(({ done, total }) => {
    const pct = Math.round((done / total) * 100);
    fill.style.width  = pct + '%';
    label.textContent = `${done} / ${total} files (${pct}%)`;
  });

  const result = await bhb.assets.download();
  if (result.ok) {
    APP.assetsReady = true;
    label.textContent = `✓ ${result.count} assets ready`;
    await sleep(800);
  } else {
    label.textContent = `⚠ Asset download failed: ${result.error}`;
    await sleep(2000);
  }
  overlay.classList.add('hidden');
}

// ── Launch App ─────────────────────────────────────────────────────────────
async function launchApp() {
  try {
  document.getElementById('app').classList.remove('hidden');

  // Version label
  const v = await bhb.app.version();
  document.getElementById('app-version').textContent = `v${v}`;

  // Nav tabs
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchTab(btn.dataset.tab);
    });
  });

  // Subtabs (Build page)
  document.querySelectorAll('.subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.subtab-panel').forEach(p => p.classList.add('hidden'));
      document.getElementById(`subtab-${btn.dataset.subtab}`).classList.remove('hidden');
    });
  });

  // Save slot button
  document.getElementById('btn-save-slot').addEventListener('click', saveCurrentSlot);
  document.getElementById('btn-new-slot').addEventListener('click', newSlot);

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('link-to-settings')?.addEventListener('click', e => { e.preventDefault(); openSettings(); });

  // Voice tab
  document.getElementById('btn-refresh-voices').addEventListener('click', loadVoices);
  document.getElementById('voice-search').addEventListener('input', filterVoices);
  document.getElementById('voice-filter-gender').addEventListener('change', filterVoices);
  setupSliders();
  document.getElementById('btn-test-voice').addEventListener('click', testVoice);
  document.getElementById('btn-apply-voice').addEventListener('click', applyVoice);

  // Chat
  document.getElementById('btn-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  document.getElementById('btn-clear-chat').addEventListener('click', clearChat);

  // Canvas size buttons
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setChatCanvasSize(parseInt(btn.dataset.size));
    });
  });
  document.getElementById('toggle-voice-mode').addEventListener('change', e => {
    APP.voiceMode = e.target.checked;
  });

  // Update ready
  bhb.app.onUpdateReady(() => {
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.textContent = '↑ Update ready — restart to install';
    document.body.prepend(banner);
  });

  await loadSlots();
  populateSettings();

  // Webview + trait picker
  initWebviews();
  } catch(e) { console.error('[launchApp]', e); document.body.style.cssText='background:#0a0a0a;color:#fa5252;font-family:monospace;padding:40px;white-space:pre'; document.body.textContent='launchApp error:\n'+(e?.stack||e); }
}

// ── Slots ──────────────────────────────────────────────────────────────────
async function loadSlots() {
  const slots = await bhb.slots.list();
  const list  = document.getElementById('slot-list');
  list.innerHTML = '';
  if (slots.length === 0) {
    list.innerHTML = '<div class="slot-empty">No characters yet</div>';
    return;
  }
  slots.forEach(slot => {
    const el = document.createElement('div');
    el.className = 'slot-item' + (slot.id === APP.currentSlotId ? ' active' : '');
    el.innerHTML = `
      <div class="slot-thumb">${slot.thumbnail ? `<img src="${slot.thumbnail}">` : '◆'}</div>
      <div class="slot-info">
        <div class="slot-name">${slot.name}</div>
        <div class="slot-tagline">${slot.tagline || '—'}</div>
      </div>
      <button class="slot-del-btn" data-id="${slot.id}" title="Delete">✕</button>
    `;
    el.querySelector('.slot-del-btn').addEventListener('click', e => {
      e.stopPropagation();
      deleteSlot(slot.id);
    });
    el.addEventListener('click', () => selectSlot(slot.id));
    list.appendChild(el);
  });
}

async function selectSlot(id) {
  APP.currentSlotId = id;
  APP.currentSoul   = await bhb.slots.load(id);
  APP.chatHistory   = [];
  loadSoulIntoForm(APP.currentSoul);
  loadSoulIntoVoice(APP.currentSoul);
  updateChatCharacter();
  applyTraitsToSelectors(APP.currentSoul.animator?.traits || {});
  loadAnimator(APP.currentSoul);
  await loadSlots(); // refresh active state
  // Show tabs, hide empty state
  document.getElementById('no-slot-msg').classList.add('hidden');
  switchTab('build');
}

async function newSlot() {
  const id   = await bhb.slots.newId();
  const soul = blankSoul(id);
  await bhb.slots.save(id, soul);
  APP.currentSlotId = id;
  APP.currentSoul   = soul;
  APP.chatHistory   = [];
  loadSoulIntoForm(soul);
  loadAnimator(soul);
  await loadSlots();
  document.getElementById('no-slot-msg').classList.add('hidden');
  switchTab('build');
}

async function deleteSlot(id) {
  if (!confirm('Delete this character?')) return;
  await bhb.slots.delete(id);
  if (APP.currentSlotId === id) {
    APP.currentSlotId = null;
    APP.currentSoul   = null;
    document.getElementById('no-slot-msg').classList.remove('hidden');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  }
  await loadSlots();
}

async function saveCurrentSlot() {
  if (!APP.currentSlotId) return;
  const soul = soulFromForm();
  APP.currentSoul = soul;
  await bhb.slots.save(APP.currentSlotId, soul);
  flashSave();
  await loadSlots();
}

function flashSave() {
  const btn = document.getElementById('btn-save-slot');
  btn.textContent = '✓ SAVED';
  setTimeout(() => { btn.textContent = 'SAVE'; }, 1500);
}

// ── Tab Switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  if (!APP.currentSlotId) {
    document.getElementById('no-slot-msg').classList.remove('hidden');
    return;
  }
  document.getElementById('no-slot-msg').classList.add('hidden');
  document.getElementById(`tab-${tab}`)?.classList.remove('hidden');

  if (tab === 'voice' && APP.voices.length === 0) loadVoices();
  if (tab === 'chat') { updateChatCharacter(); if (APP.currentSoul && !WEBVIEWS.animator.wcId) loadAnimator(APP.currentSoul); }
}

// ── Soul Form ──────────────────────────────────────────────────────────────
function soulFromForm() {
  const prev = APP.currentSoul || {};
  return {
    schema_version: '1.0',
    character_id: v('soul-id')   || prev.character_id || `slot_${Date.now()}`,
    name:         v('soul-name') || prev.name || 'Unnamed',
    tagline:      v('soul-tagline'),
    personality: {
      archetype:      v('soul-archetype'),
      traits:         csv('soul-traits'),
      flaw:           v('soul-flaw'),
      speaking_style: v('soul-speaking-style'),
      never_says:     csv('soul-never-says'),
      always_says:    csv('soul-always-says'),
      fears:          prev.personality?.fears || [],
      desires:        prev.personality?.desires || [],
    },
    backstory: {
      origin:     v('soul-origin'),
      occupation: v('soul-occupation'),
      history:    v('soul-history'),
    },
    voice: {
      elevenlabs_voice_id: APP.selectedVoice?.voice_id || prev.voice?.elevenlabs_voice_id || null,
      resolve_voice: prev.voice?.resolve_voice || { descriptors: {}, fallback_voice_id: null },
      stability:        sliderVal('slider-stability'),
      similarity_boost: sliderVal('slider-similarity'),
      style:            sliderVal('slider-style'),
      speaker_boost:    document.getElementById('toggle-speaker-boost').checked,
      notes: prev.voice?.notes || '',
    },
    animator: {
      traits:          prev.animator?.traits || {},
      mood_preset:     v('soul-mood'),
      expression_map:  prev.animator?.expression_map || defaultExpressionMap(),
    },
    agent_instructions: {
      agent_session_endpoint: 'https://bigheadbillionaires.com/api/agent-session',
      prompt_prefix:    v('soul-prompt-prefix'),
      content_boundaries: csv('soul-boundaries'),
      default_scene:    prev.agent_instructions?.default_scene || 'Graphite',
    },
    memory: prev.memory || { knows: [], relationships: [], notable_events: [] },
    _thumbnail: prev._thumbnail || null,
  };
}

function loadSoulIntoForm(soul) {
  if (!soul) return;
  set('soul-id',            soul.character_id || '');
  set('soul-name',          soul.name || '');
  set('soul-tagline',       soul.tagline || '');
  set('soul-archetype',     soul.personality?.archetype || '');
  set('soul-flaw',          soul.personality?.flaw || '');
  set('soul-speaking-style', soul.personality?.speaking_style || '');
  set('soul-traits',        (soul.personality?.traits || []).join(', '));
  set('soul-never-says',    (soul.personality?.never_says || []).join(', '));
  set('soul-always-says',   (soul.personality?.always_says || []).join(', '));
  set('soul-origin',        soul.backstory?.origin || '');
  set('soul-occupation',    soul.backstory?.occupation || '');
  set('soul-history',       soul.backstory?.history || '');
  set('soul-prompt-prefix', soul.agent_instructions?.prompt_prefix || '');
  set('soul-boundaries',    (soul.agent_instructions?.content_boundaries || []).join(', '));
  setSelect('soul-mood',    soul.animator?.mood_preset || 'calm');
  if (soul.voice) {
    document.getElementById('slider-stability').value  = soul.voice.stability        ?? 0.45;
    document.getElementById('slider-similarity').value = soul.voice.similarity_boost ?? 0.75;
    document.getElementById('slider-style').value      = soul.voice.style            ?? 0.30;
    document.getElementById('toggle-speaker-boost').checked = soul.voice.speaker_boost ?? true;
    updateSliderLabels();
  }
}

function loadSoulIntoVoice(soul) {
  if (!soul?.voice?.elevenlabs_voice_id) return;
  // Mark voice as selected if it matches
  if (APP.voices.length > 0) {
    const match = APP.voices.find(v => v.voice_id === soul.voice.elevenlabs_voice_id);
    if (match) selectVoice(match, false);
  }
}

// ── Voice Browser ──────────────────────────────────────────────────────────
async function loadVoices() {
  const elKey = APP.keys.elevenlabs;
  if (!elKey) {
    document.getElementById('voice-no-key').classList.remove('hidden');
    document.getElementById('voice-list').innerHTML = '';
    return;
  }
  document.getElementById('voice-no-key').classList.add('hidden');
  document.getElementById('voice-list').innerHTML = '<div class="voice-loading">Loading voices...</div>';
  try {
    APP.voices = await bhb.elevenlabs.voices(elKey);
    renderVoiceList(APP.voices);
    if (APP.currentSoul?.voice?.elevenlabs_voice_id) loadSoulIntoVoice(APP.currentSoul);
  } catch (e) {
    document.getElementById('voice-list').innerHTML = `<div class="voice-error">Error: ${e.message}</div>`;
  }
}

function renderVoiceList(voices) {
  const list = document.getElementById('voice-list');
  list.innerHTML = '';
  if (voices.length === 0) { list.innerHTML = '<div class="voice-loading">No voices found.</div>'; return; }
  voices.forEach(voice => {
    const el = document.createElement('div');
    el.className = 'voice-item' + (voice.voice_id === APP.selectedVoice?.voice_id ? ' selected' : '');
    const gender  = voice.labels?.gender || '';
    const age     = voice.labels?.age    || '';
    const desc    = voice.labels?.description || voice.category || '';
    el.innerHTML = `
      <div class="voice-item-name">${voice.name}</div>
      <div class="voice-item-meta">${[gender, age, desc].filter(Boolean).join(' · ')}</div>
      ${voice.preview_url ? `<button class="voice-preview-btn" data-url="${voice.preview_url}" title="Preview">▶</button>` : ''}
    `;
    el.querySelector('.voice-preview-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      previewVoice(voice.preview_url);
    });
    el.addEventListener('click', () => selectVoice(voice, true));
    list.appendChild(el);
  });
}

function filterVoices() {
  const q      = document.getElementById('voice-search').value.toLowerCase();
  const gender = document.getElementById('voice-filter-gender').value.toLowerCase();
  const filtered = APP.voices.filter(v => {
    const matchQ = !q || v.name.toLowerCase().includes(q) || (v.labels?.description || '').toLowerCase().includes(q);
    const matchG = !gender || (v.labels?.gender || '').toLowerCase() === gender;
    return matchQ && matchG;
  });
  renderVoiceList(filtered);
}

function selectVoice(voice, scrollIntoView = false) {
  APP.selectedVoice = voice;
  document.getElementById('voice-selected-name').textContent = voice.name;
  document.querySelectorAll('.voice-item').forEach(el => {
    el.classList.toggle('selected', el.querySelector('.voice-item-name')?.textContent === voice.name);
  });
  if (voice.preview_url) {
    const pp = document.getElementById('voice-preview-player');
    pp.classList.remove('hidden');
    document.getElementById('voice-preview-audio').src = voice.preview_url;
  }
}

function previewVoice(url) {
  const audio = document.getElementById('voice-preview-audio');
  audio.src = url;
  audio.play();
  document.getElementById('voice-preview-player').classList.remove('hidden');
}

async function testVoice() {
  if (!APP.selectedVoice) { alert('Select a voice first.'); return; }
  const text = document.getElementById('voice-test-text').value.trim();
  if (!text) return;
  const btn = document.getElementById('btn-test-voice');
  btn.textContent = '⏳ Generating...'; btn.disabled = true;
  try {
    const filePath = await bhb.elevenlabs.tts({
      apiKey:   APP.keys.elevenlabs,
      voiceId:  APP.selectedVoice.voice_id,
      text,
      settings: currentVoiceSettings()
    });
    const audio = document.getElementById('voice-test-audio');
    audio.src   = `file://${filePath}`;
    audio.play();
    document.getElementById('voice-test-player').classList.remove('hidden');
  } catch (e) { alert(`TTS error: ${e.message}`); }
  btn.textContent = '▶ GENERATE TEST'; btn.disabled = false;
}

function applyVoice() {
  if (!APP.selectedVoice || !APP.currentSoul) return;
  APP.currentSoul.voice.elevenlabs_voice_id = APP.selectedVoice.voice_id;
  APP.currentSoul.voice = { ...APP.currentSoul.voice, ...currentVoiceSettings() };
  // Persist
  if (APP.currentSlotId) bhb.slots.save(APP.currentSlotId, APP.currentSoul);
  document.getElementById('btn-apply-voice').textContent = '✓ APPLIED';
  setTimeout(() => { document.getElementById('btn-apply-voice').textContent = '✓ APPLY TO CHARACTER'; }, 1500);
}

function currentVoiceSettings() {
  return {
    stability:        sliderVal('slider-stability'),
    similarity_boost: sliderVal('slider-similarity'),
    style:            sliderVal('slider-style'),
    speaker_boost:    document.getElementById('toggle-speaker-boost').checked,
  };
}

function setupSliders() {
  ['stability', 'similarity', 'style'].forEach(name => {
    const slider = document.getElementById(`slider-${name}`);
    const label  = document.getElementById(`val-${name}`);
    slider.addEventListener('input', () => { label.textContent = parseFloat(slider.value).toFixed(2); });
  });
}

function updateSliderLabels() {
  document.getElementById('val-stability').textContent  = parseFloat(document.getElementById('slider-stability').value).toFixed(2);
  document.getElementById('val-similarity').textContent = parseFloat(document.getElementById('slider-similarity').value).toFixed(2);
  document.getElementById('val-style').textContent      = parseFloat(document.getElementById('slider-style').value).toFixed(2);
}

// ── Chat ───────────────────────────────────────────────────────────────────
// ── BHBAnimator init — call once when chat tab first shows ──────────────────
let _animatorInited = false;
function initChatAnimator() {
  if (_animatorInited) return;
  const canvas = document.getElementById('chat-canvas');
  if (!canvas) return;
  BHBAnimator.init(canvas);
  BHBAnimator.setOnEnded(() => {
    setStatus('Ready');
    document.getElementById('chat-audio-bar')?.classList.add('hidden');
  });
  _animatorInited = true;
}

function renderChatCanvas() {
  // Legacy static-render fallback (used when no audio is loaded)
  // BHBAnimator handles live rendering during playback
  if (_animatorInited && !BHBAnimator.isPlaying()) {
    // Just redraw current frame (traits may have changed)
  }
}

function setChatCanvasSize(px) {
  const canvas = document.getElementById('chat-canvas');
  const panel  = document.querySelector('.chat-character-panel');
  if (!canvas || !panel) return;
  canvas.style.width  = px + 'px';
  canvas.style.height = px + 'px';
  // Widen the character panel column to fit
  const layout = document.querySelector('.chat-layout');
  if (layout) layout.style.gridTemplateColumns = `${px + 40}px 1fr`;
}

function updateChatCharacter() {
  const soul = APP.currentSoul;
  const nameEl = document.getElementById('chat-char-name');
  if (!soul) { if (nameEl) nameEl.textContent = '— no character —'; return; }
  if (nameEl) nameEl.textContent = soul.name || 'Unknown';
  setStatus('Ready');

  initChatAnimator();
  if (soul.animator?.traits) {
    BHBAnimator.setTraits(
      soul.animator.traits,
      soul._female || false,
      soul.animator.mood_preset || 'happy'
    );
  }
}

function buildSystemPrompt(soul) {
  const base   = soul.agent_instructions?.prompt_prefix || `You are ${soul.name}.`;
  const style  = soul.personality?.speaking_style  ? `\n\nSpeaking style: ${soul.personality.speaking_style}` : '';
  const never  = soul.personality?.never_says?.length  ? `\n\nNever say: ${soul.personality.never_says.join(', ')}` : '';
  const always = soul.personality?.always_says?.length ? `\nSignature phrases: ${soul.personality.always_says.join(', ')}` : '';
  const bg     = soul.backstory?.history ? `\n\nBackstory: ${soul.backstory.history}` : '';
  return base + style + never + always + bg +
    '\n\nKeep responses conversational and in-character. 1-3 sentences unless asked for more.';
}

function setTyping(on) {
  document.getElementById('chat-typing')?.classList.toggle('hidden', !on);
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || !APP.currentSoul) return;

  const provider = APP.settings.provider || 'anthropic';
  const apiKey   = APP.keys[provider];
  if (!apiKey) {
    addMessage('error', `No ${provider} API key set. Open Settings to add one.`);
    return;
  }

  input.value = '';
  addMessage('user', text);
  APP.chatHistory.push({ role: 'user', content: text });

  const sendBtn = document.getElementById('btn-send');
  sendBtn.disabled = true;
  setTyping(true);
  setStatus('Thinking...');

  try {
    const response = await bhb.ai.chat({
      provider,
      apiKey,
      model:        APP.settings.model,
      messages:     APP.chatHistory,
      systemPrompt: buildSystemPrompt(APP.currentSoul),
    });

    setTyping(false);
    APP.chatHistory.push({ role: 'assistant', content: response });
    addMessage('assistant', response);

    if (APP.voiceMode && APP.currentSoul.voice?.elevenlabs_voice_id && APP.keys.elevenlabs) {
      setStatus('Speaking...');
      await speakResponse(response);
    } else {
      setStatus('Ready');
    }
  } catch (e) {
    setTyping(false);
    addMessage('error', `Error: ${e.message}`);
    setStatus('Error — check console');
    console.error('[sendChat]', e);
  }

  sendBtn.disabled = false;
}


// ── Webview Manager ───────────────────────────────────────────────────────

// ── Asset Base (matches actual CDN) ───────────────────────────────────────
const ASSET_BASE = 'https://bhaleyart.github.io/BigHeadCharacterCooker';

// ── Trait Data (sourced directly from customizer.html) ─────────────────────
const TRAIT_DATA = {
  BODY: { folder:'BODY', files:[
    'Blank.png','Charcoal.png','High Voltage.png','Nebulous.png','Pinky.png','Shockwave.png',
    'Tangerine.png','Turquoise.png','Woody.png','Frogger.png','Area 51.png','Dark Tone.png',
    'Mid Tone.png','Light Tone.png','Jolly Roger.png','Cyber Punk.png','Talking Corpse.png',
    'Day Tripper.png','Meat Lover.png','Golden God.png','Chrome Dome.png','Candy Gloss.png',
    'Man On Fire.png','Water Boy.png','Icecream Man.png','Reptilian.png','Juiced Up.png',
    'Toxic Waste.png','Love Potion.png','Pop Artist.png','Autopsy.png','Ghostly.png',
    'Blue Screen.png','Networker.png','IceMan.png','TheLizard.png','Primal.png','PanduBeru.png'
  ]},
  BACKGROUNDS: { folder:'BACKGROUNDS', files:[
    'None.png','Natural.png','Mania.png','Regal.png','Lavish.png','Sunflower.png','Snowflake.png',
    'Bleach.png','Vibes.png','Burst.png','Aquatic.png','Passionate.png','Envious.png',
    'Enlightened.png','Haunted.png','Cursed.png','SolFlare.png','Tangerine.png','Navy.png',
    'Crimson.png','Graphite.png','Eggshell.png','Slate.png','Kuwai.png','Velvet.png',
    'Money.png','Sky.png'
  ]},
  EYES: { folder:'EYES', files:[
    'Curious.png','Alien.png','Annoyed.png','Demonic.png','Diamond.png','Dots.png',
    'Grumpy.png','Hypnotized.png','Infuriated.png','Insect.png','Joy.png',
    'Light Bright.png','Monocle.png','Ouchy.png','Paranoid.png','Possessed.png',
    'Ruby Stare.png','Spider.png','Stare.png','Stoney Eyes.png','Sunglasses.png',
    'Surprised.png','Tears.png','Deceased.png','Too Chill.png','VR Headset.png',
    '3D Glasses.png','Blink.png','Stern.png','Tears.gif'
  ]},
  MOUTH: { folder:'MOUTH', files:[
    'Mmm.png','Simpleton.png','Stache.png','Creeper.png','Pierced.png','Fangs.png',
    'Gold Teeth.png','Diamond Teeth.png','CandyGrill.png','Birdy.png','Panic.png','Sss.png',
    'Ahh.png','Ehh.png','Uhh.png','LLL.png','Rrr.png','Fff.png','Ooo.png','Thh.png',
    'Eee.png','Haha.png','Rofl.png','Bean Frown.png','Bean Smile.png','Smirk.png',
    'Bored.png','Gas Mask.png','Scuba.png','Quacked.png'
  ]},
  HEAD: { folder:'HEAD', files:[
    'None.png','Antenna.png','Bandana Bro.png','Beanie.png','Blonde Beanie.png',
    'Blonde Bun.png','Blue Bedhead.png','Brain Squid.png','Bravo.png','Brunette Beanie.png',
    'Brunette Ponytail.png','Burger Crown.png','Captain Hat.png','Mullet.png','Cat Hat.png',
    'Chad Bandana.png','Cherry Sundae.png','Clown Wig.png','Fancy Hat.png','Fireman.png',
    'Flame Princess.png','Fossilized.png','Gamer Girl.png','Ginger Ponytail.png','Kpop.png',
    'Yagami.png','Raven.png','Heated.png','Inferno.png','Horny Horns.png','Hunted.png',
    'Jester.png','Kingly.png','Mad Hatter.png','Masked Up.png','Mohawk Blue.png',
    'Mohawk Green.png','Mohawk Red.png','Mortricia.png','Outlaw.png','Overload.png',
    'Patrol Cap.png','Pharaoh Hat.png','Pink Pigtails.png','Powdered Wig.png','Press Pass.png',
    'Propeller.png','Rainbow Babe.png','Recon Helmet.png','Robin Hood.png','Santa Hat.png',
    'Sewer Slime.png','Snapback Blue.png','Snapback Hippy.png','Snapback Red.png',
    'Snapback Yellow.png','Sombrero.png','Spiritual.png','Surgeon.png','UwU Kitty.png',
    'Valhalla Cap.png','Way Dizzy.png','FoxFamous.png','Unplugged.png','Party-Animal.png'
  ]},
  OUTFIT: { folder:'OUTFIT', files:[
    'None.png','Blue Tee.png','Blueberry Dye.png','Degen Green.png','Degen Purple.png',
    'Earthy Dye.png','Hodl Black.png','Hodl White.png','Locked Up.png','Moto-X.png',
    'Orange Zip.png','Passion Dye.png','Pink Zip.png','Raider Ref.png','Red Tee.png',
    'Smally Bigs.png','Yellow Tee.png','Blue Zip.png','Red Zip.png','White Zip.png',
    'Hornet Zip.png','Ghostly Zip.png','Gold Jacket.png','Tuxedo.png','Thrashed.png',
    'The Fuzz.png','Pin Striped.png','Designer Zip.png','Luxury Zip.png','Explorer.png',
    'Power Armor.png','Shinobi.png','Thrilled.png','Trenches.png','Ski Jacket.png',
    'Sled Jacket.png','Commando.png','Space Cadet.png','Burgler.png','Commandant.png',
    'Golden Knight.png','Honey Bee.png','Necromancer.png','Paladin.png','Refined Suit.png',
    'Sexy Jacket.png','Stoner Hoodie.png','The Duke.png','Rave Hoodie.png',
    'Scuba suit temp.png','Burger Suit.png','Scrubs.png','FlaredUp.png','Shiller.png',
    'MetalFan.png','BH-Tshirt.png','Uni-Fyed.png','SuperFlare.png','BoigaRed.png'
  ]},
  TEXTURE: { folder:'TEXTURE', files:[
    'None.png','Blood.png','Acid.png','Ink.png','Dart Frog Blue.png','Dart Frog Red.png',
    'Dart Frog Yellow.png','Magical.png','Puzzled.png','Rug Life Ink.png','Pulverized.png',
    'FlaredInk.png'
  ]},
};

// Female-only layers
const FEMALE_LAYERS = {
  EYELASHES: { folder:'GIRL', files:['Eyelashes.png'] },
  BREASTS:   { folder:'GIRL', files:['Breasts.png'] },
};

// Layer composite order (matches animator exactly)
const LAYER_ORDER = ['BACKGROUNDS','BODY','TEXTURE','OUTFIT','BREASTS','HEAD','MOUTH','EYELASHES','EYES'];

// Selector order (UI only — no BACKGROUNDS key, uses BACKGROUND alias)
const TRAIT_SLOT_ORDER = ['BODY','HEAD','EYES','MOUTH','OUTFIT','TEXTURE','BACKGROUNDS'];

// Display name → internal key mapping for the dropdowns
const SLOT_DISPLAY = {
  BODY:'BODY', HEAD:'HEAD', EYES:'EYES', MOUTH:'MOUTH',
  OUTFIT:'OUTFIT', TEXTURE:'TEXTURE', BACKGROUNDS:'BACKGROUND',
};

// ── Subset Eyes (sourced directly from animator.html) ──────────────────────
const SUBSET_EYES = {
  'Alien.png':       { 'Stare.png':'EYES/SUBSET/alien.png','Blink.png':'EYES/SUBSET/alien-blink.png','Ouchy.png':'EYES/SUBSET/alien-ouchy.png','Infuriated.png':'EYES/SUBSET/alien-infuriated.png','Surprised.png':'EYES/SUBSET/alien-surprised.png','Stern.png':'EYES/SUBSET/alien-stern.png','Joy.png':'EYES/SUBSET/alien-joy.png','Curious.png':'EYES/SUBSET/alien-curious.png' },
  'Sunglasses.png':  { 'Stare.png':'EYES/SUBSET/sunglasses.png','Blink.png':'EYES/SUBSET/sunglasses-blink.png','Ouchy.png':'EYES/SUBSET/sunglasses-ouchy.png','Infuriated.png':'EYES/SUBSET/sunglasses-infuriated.png','Surprised.png':'EYES/SUBSET/sunglasses-surprised.png','Stern.png':'EYES/SUBSET/sunglasses-stern.png','Joy.png':'EYES/SUBSET/sunglasses-joy.png','Curious.png':'EYES/SUBSET/sunglasses-curious.png' },
  '3D Glasses.png':  { 'Stare.png':'EYES/SUBSET/3dglasses.png','Blink.png':'EYES/SUBSET/3dglasses-blink.png','Ouchy.png':'EYES/SUBSET/3dglasses-ouchy.png','Infuriated.png':'EYES/SUBSET/3dglasses-infuriated.png','Surprised.png':'EYES/SUBSET/3dglasses-surprised.png','Stern.png':'EYES/SUBSET/3dglasses-stern.png','Joy.png':'EYES/SUBSET/3dglasses-joy.png','Curious.png':'EYES/SUBSET/3dglasses-curious.png' },
  'Spider.png':      { 'Stare.png':'EYES/SUBSET/spider.png','Blink.png':'EYES/SUBSET/spider-blink.png','Ouchy.png':'EYES/SUBSET/spider-ouchy.png','Infuriated.png':'EYES/SUBSET/spider-infuriated.png','Surprised.png':'EYES/SUBSET/spider-surprised.png','Stern.png':'EYES/SUBSET/spider-stern.png','Joy.png':'EYES/SUBSET/spider-joy.png','Curious.png':'EYES/SUBSET/spider-curious.png' },
  'Diamond.png':     { 'Stare.png':'EYES/SUBSET/diamond.png','Blink.png':'EYES/SUBSET/diamond-blink.png','Ouchy.png':'EYES/SUBSET/diamond-ouchy.png','Infuriated.png':'EYES/SUBSET/diamond-infuriated.png','Surprised.png':'EYES/SUBSET/diamond-surprised.png','Stern.png':'EYES/SUBSET/diamond-stern.png','Joy.png':'EYES/SUBSET/diamond-joy.png','Curious.png':'EYES/SUBSET/diamond-curious.png' },
  'Ruby Stare.png':  { 'Stare.png':'EYES/SUBSET/ruby.png','Blink.png':'EYES/SUBSET/ruby-blink.png','Ouchy.png':'EYES/SUBSET/ruby-ouchy.png','Infuriated.png':'EYES/SUBSET/ruby-infuriated.png','Surprised.png':'EYES/SUBSET/ruby-surprised.png','Stern.png':'EYES/SUBSET/ruby-stern.png','Joy.png':'EYES/SUBSET/ruby-joy.png','Curious.png':'EYES/SUBSET/ruby-curious.png' },
  'Hypnotized.png':  { 'Stare.png':'EYES/SUBSET/hypnotized.png','Blink.png':'EYES/SUBSET/hypnotized-blink.png','Ouchy.png':'EYES/SUBSET/hypnotized-ouchy.png','Infuriated.png':'EYES/SUBSET/hypnotized-infuriated.png','Surprised.png':'EYES/SUBSET/hypnotized-surprised.png','Stern.png':'EYES/SUBSET/hypnotized-stern.png','Joy.png':'EYES/SUBSET/hypnotized-joy.png','Curious.png':'EYES/SUBSET/hypnotized-curious.png' },
  'Monocle.png':     { 'Stare.png':'EYES/SUBSET/monocle.png','Blink.png':'EYES/SUBSET/monocle-blink.png','Ouchy.png':'EYES/SUBSET/monocle-ouchy.png','Infuriated.png':'EYES/SUBSET/monocle-infuriated.png','Surprised.png':'EYES/SUBSET/monocle-surprised.png','Stern.png':'EYES/SUBSET/monocle-stern.png','Joy.png':'EYES/SUBSET/monocle-joy.png','Curious.png':'EYES/SUBSET/monocle-curious.png' },
  'Demonic.png':     { 'Stare.png':'EYES/SUBSET/demonic.png','Blink.png':'EYES/SUBSET/demonic-blink.png','Ouchy.png':'EYES/SUBSET/demonic-ouchy.png','Infuriated.png':'EYES/SUBSET/demonic-infuriated.png','Surprised.png':'EYES/SUBSET/demonic-surprised.png','Stern.png':'EYES/SUBSET/demonic-stern.png','Joy.png':'EYES/SUBSET/demonic-joy.png','Curious.png':'EYES/SUBSET/demonic-curious.png' },
  'Light Bright.png':{ 'Stare.png':'EYES/SUBSET/lightbright.png','Blink.png':'EYES/SUBSET/lightbright-blink.png','Ouchy.png':'EYES/SUBSET/lightbright-ouchy.png','Infuriated.png':'EYES/SUBSET/lightbright-infuriated.png','Surprised.png':'EYES/SUBSET/lightbright-surprised.png','Stern.png':'EYES/SUBSET/lightbright-stern.png','Joy.png':'EYES/SUBSET/lightbright-joy.png','Curious.png':'EYES/SUBSET/lightbright-curious.png' },
  'Possessed.png':   { 'Stare.png':'EYES/SUBSET/possesed.png','Blink.png':'EYES/SUBSET/possesed-blink.png','Ouchy.png':'EYES/SUBSET/possesed-ouchy.png','Infuriated.png':'EYES/SUBSET/possesed-infuriated.png','Surprised.png':'EYES/SUBSET/possesed-surprised.png','Stern.png':'EYES/SUBSET/possesed-stern.png','Joy.png':'EYES/SUBSET/possesed-joy.png','Curious.png':'EYES/SUBSET/possesed-curious.png' },
  'Dots.png':        { 'Stare.png':'EYES/SUBSET/dots.png','Blink.png':'EYES/SUBSET/dots-blink.png','Ouchy.png':'EYES/SUBSET/dots-ouchy.png','Infuriated.png':'EYES/SUBSET/dots-infuriated.png','Surprised.png':'EYES/SUBSET/dots-surprised.png','Stern.png':'EYES/SUBSET/dots-stern.png','Joy.png':'EYES/SUBSET/dots-joy.png','Curious.png':'EYES/SUBSET/dots-curious.png' },
  'Stoney Eyes.png': { 'Stare.png':'EYES/SUBSET/stoneyeyes.png','Blink.png':'EYES/SUBSET/stoneyeyes-blink.png','Ouchy.png':'EYES/SUBSET/stoneyeyes-ouchy.png','Infuriated.png':'EYES/SUBSET/stoneyeyes-infuriated.png','Surprised.png':'EYES/SUBSET/stoneyeyes-surprised.png','Stern.png':'EYES/SUBSET/stoneyeyes-stern.png','Joy.png':'EYES/SUBSET/stoneyeyes-joy.png','Curious.png':'EYES/SUBSET/stoneyeyes-curious.png' },
  'VR Headset.png':  { 'Stare.png':'EYES/SUBSET/vrheadset.png','Blink.png':'EYES/SUBSET/vrheadset.png','Ouchy.png':'EYES/SUBSET/vrheadset.png','Infuriated.png':'EYES/SUBSET/vrheadset.png','Surprised.png':'EYES/SUBSET/vrheadset.png','Stern.png':'EYES/SUBSET/vrheadset.png','Joy.png':'EYES/SUBSET/vrheadset.png','Curious.png':'EYES/SUBSET/vrheadset.png' },
  'Too Chill.png':   { 'Stare.png':'EYES/SUBSET/toochill.png','Blink.png':'EYES/SUBSET/toochill-blink.png','Ouchy.png':'EYES/SUBSET/toochill-blink.png','Infuriated.png':'EYES/SUBSET/toochill.png','Surprised.png':'EYES/SUBSET/toochill.png','Stern.png':'EYES/SUBSET/toochill.png','Joy.png':'EYES/SUBSET/toochill.png','Curious.png':'EYES/SUBSET/toochill.png' },
  'Deceased.png':    { 'Stare.png':'EYES/SUBSET/deceased.png','Blink.png':'EYES/SUBSET/deceased-blink.png','Ouchy.png':'EYES/SUBSET/deceased-ouchy.png','Infuriated.png':'EYES/SUBSET/deceased.png','Surprised.png':'EYES/SUBSET/deceased.png','Stern.png':'EYES/SUBSET/deceased.png','Joy.png':'EYES/SUBSET/deceased.png','Curious.png':'EYES/SUBSET/deceased.png' },
  'Grumpy.png':      { 'Stare.png':'EYES/SUBSET/grumpy.png','Blink.png':'EYES/SUBSET/grumpy-ouchy.png','Ouchy.png':'EYES/SUBSET/grumpy-ouchy.png','Infuriated.png':'EYES/SUBSET/grumpy.png','Surprised.png':'EYES/SUBSET/grumpy.png','Stern.png':'EYES/SUBSET/grumpy.png','Joy.png':'EYES/SUBSET/grumpy.png','Curious.png':'EYES/SUBSET/grumpy.png' },
  'Paranoid.png':    { 'Stare.png':'EYES/SUBSET/paranoid.png','Blink.png':'EYES/SUBSET/paranoid-ouchy.png','Ouchy.png':'EYES/SUBSET/paranoid-ouchy.png','Infuriated.png':'EYES/SUBSET/paranoid.png','Surprised.png':'EYES/SUBSET/paranoid.png','Stern.png':'EYES/SUBSET/paranoid.png','Joy.png':'EYES/SUBSET/paranoid.png','Curious.png':'EYES/SUBSET/paranoid.png' },
  'Insect.png':      { 'Stare.png':'EYES/SUBSET/insect.png','Blink.png':'EYES/SUBSET/insect-ouchy.png','Ouchy.png':'EYES/SUBSET/insect-ouchy.png','Infuriated.png':'EYES/SUBSET/insect.png','Surprised.png':'EYES/SUBSET/insect.png','Stern.png':'EYES/SUBSET/insect.png','Joy.png':'EYES/SUBSET/insect.png','Curious.png':'EYES/SUBSET/insect.png' },
  'Annoyed.png':     { 'Stare.png':'EYES/SUBSET/annoyed.png','Blink.png':'EYES/SUBSET/annoyed-blink.png','Ouchy.png':'EYES/SUBSET/annoyed-blink.png','Infuriated.png':'EYES/SUBSET/annoyed.png','Surprised.png':'EYES/SUBSET/annoyed.png','Stern.png':'EYES/SUBSET/annoyed.png','Joy.png':'EYES/SUBSET/annoyed.png','Curious.png':'EYES/SUBSET/annoyed.png' },
};

// Lip sync mouth frame thresholds (matches animator.html volumeAtForChar logic)
const LIPSYNC_MOUTH = {
  // vol > threshold → mouth frame to use
  // syncStyle 'ooo' uses Ooo.png for mid, default uses Ehh.png
  thresholds: [
    { vol: 0.12, frame: 'Ahh.png' },
    { vol: 0.05, frame: 'Ehh.png' },  // or Ooo.png in ooo mode
    { vol: 0.02, frame: 'Eee.png' },
  ],
  closed: 'Mmm.png',
};



// Current in-memory trait selections (mirrors to soul on every change)
const SELECTED_TRAITS = { BODY:'Dark Tone.png', HEAD:'None.png', EYES:'Stare.png', MOUTH:'Mmm.png', OUTFIT:'None.png', TEXTURE:'None.png', BACKGROUNDS:'Graphite.png' };

// ── Build native trait picker ──────────────────────────────────────────────
// ── Canvas Preview Renderer ───────────────────────────────────────────────
// Loads layers from ASSET_BASE CDN and composites them onto #trait-canvas
// in LAYER_ORDER, matching the real Customizer exactly.

const PREVIEW_IMG_CACHE = {};

function loadPreviewImg(url) {
  if (PREVIEW_IMG_CACHE[url]) return PREVIEW_IMG_CACHE[url];
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  PREVIEW_IMG_CACHE[url] = img;
  return img;
}

function renderPreviewCanvas() {
  const canvas = document.getElementById('trait-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const female = document.getElementById('trait-female')?.checked || false;

  // Collect one image per layer slot in render order
  const jobs = LAYER_ORDER.map(layer => {
    // Female-only layers
    if (FEMALE_LAYERS[layer]) {
      if (!female) return null;
      const file = FEMALE_LAYERS[layer].files[0];
      return loadPreviewImg(`${ASSET_BASE}/${FEMALE_LAYERS[layer].folder}/${encodeURIComponent(file)}`);
    }
    const def = TRAIT_DATA[layer];
    if (!def) return null;
    const fileVal = SELECTED_TRAITS[layer];
    if (!fileVal || fileVal === 'None.png') return null;
    return loadPreviewImg(`${ASSET_BASE}/${def.folder}/${encodeURIComponent(fileVal)}`);
  });

  let pending = jobs.filter(Boolean).filter(img => !img.complete).length;

  function drawAll() {
    ctx.clearRect(0, 0, W, H);
    jobs.forEach(img => {
      if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(img, 0, 0, W, H);
      }
    });
  }

  if (pending === 0) {
    drawAll();
  } else {
    jobs.forEach(img => {
      if (img && !img.complete) {
        img.onload  = () => { pending--; if (pending <= 0) drawAll(); };
        img.onerror = () => { pending--; if (pending <= 0) drawAll(); };
      }
    });
    // Draw what's already loaded while waiting
    drawAll();
  }
}

function initTraitPicker() {
  const container = document.getElementById('trait-slots');
  if (!container) return;
  container.innerHTML = '';

  TRAIT_SLOT_ORDER.forEach(slot => {
    const files   = TRAIT_DATA[slot]?.files || [];
    // Strip .png/.gif for display; keep filename as value
    const label   = slot === 'BACKGROUNDS' ? 'BACKGROUND' : slot;
    const current = SELECTED_TRAITS[slot] || files[0] || '';

    const row = document.createElement('div');
    row.className = 'trait-row';
    row.innerHTML = `
      <div class="trait-slot-label">${label}</div>
      <button class="trait-arrow" data-slot="${slot}" data-dir="-1">‹</button>
      <select class="trait-select" id="trait-select-${slot}">
        ${files.map(f => {
          const name = f.replace(/\.(png|gif)$/i,'');
          return `<option value="${f}" ${f === current ? 'selected' : ''}>${name}</option>`;
        }).join('')}
      </select>
      <button class="trait-arrow" data-slot="${slot}" data-dir="1">›</button>
    `;

    // Arrow buttons
    row.querySelectorAll('.trait-arrow').forEach(btn => {
      btn.addEventListener('click', () => {
        const sel  = document.getElementById(`trait-select-${btn.dataset.slot}`);
        const dir  = parseInt(btn.dataset.dir);
        const opts = TRAIT_DATA[btn.dataset.slot]?.files || [];
        const cur  = opts.indexOf(sel.value);
        const next = (cur + dir + opts.length) % opts.length;
        sel.value = opts[next];
        sel.dispatchEvent(new Event('change'));
      });
    });

    // Select dropdown
    const sel = row.querySelector('.trait-select');
    sel.addEventListener('change', () => {
      SELECTED_TRAITS[slot] = sel.value;
      onTraitChange();
      renderPreviewCanvas();
    });

    container.appendChild(row);
  });

  // Female toggle
  document.getElementById('trait-female')?.addEventListener('change', () => {
    onTraitChange();
    renderPreviewCanvas();
  });

  // Load saved traits if a soul is active
  if (APP.currentSoul?.animator?.traits) {
    applyTraitsToSelectors(APP.currentSoul.animator.traits);
  }

  // Initial preview render
  renderPreviewCanvas();
}

function applyTraitsToSelectors(traits) {
  // soul.animator.traits stores names without extension (e.g. "Dark Tone")
  // TRAIT_DATA files have extension (e.g. "Dark Tone.png")
  // Map BACKGROUND key → BACKGROUNDS for the internal slot
  const slotMap = { BACKGROUND: 'BACKGROUNDS' };

  for (let [slot, val] of Object.entries(traits)) {
    const internalSlot = slotMap[slot] || slot;
    const files = TRAIT_DATA[internalSlot]?.files || [];
    // Try exact match first, then match by stripping extension
    let fileVal = files.find(f => f === val)
               || files.find(f => f.replace(/\.(png|gif)$/i,'') === val);
    if (!fileVal) continue;
    const sel = document.getElementById(`trait-select-${internalSlot}`);
    if (sel) {
      sel.value = fileVal;
      SELECTED_TRAITS[internalSlot] = fileVal;
    }
  }
  if (APP.currentSoul?._female) {
    const tog = document.getElementById('trait-female');
    if (tog) tog.checked = APP.currentSoul._female;
  }
  renderPreviewCanvas();
}

function onTraitChange() {
  if (!APP.currentSoul) return;
  const female = document.getElementById('trait-female')?.checked || false;

  // Build traits object with names stripped of extension, BACKGROUNDS → BACKGROUND
  const traits = {};
  for (const [slot, fileVal] of Object.entries(SELECTED_TRAITS)) {
    const soulKey = slot === 'BACKGROUNDS' ? 'BACKGROUND' : slot;
    traits[soulKey] = fileVal.replace(/\.(png|gif)$/i, '');
  }

  if (!APP.currentSoul.animator) APP.currentSoul.animator = {};
  APP.currentSoul.animator.traits = traits;
  APP.currentSoul._female = female;

  if (APP.currentSlotId) bhb.slots.save(APP.currentSlotId, APP.currentSoul);
  pushTraitsToAnimator(APP.currentSoul);
}

// ── Animator webview (kept — still used for Chat lip sync) ─────────────────


function initWebviews() {
  // Animator is now native (BHBAnimator module) — no webview needed
  // Just init the trait picker
  initTraitPicker();
}

function sendToWebview(name, channel, data = {}) {
  const wv = WEBVIEWS[name];
  if (!wv?.wcId) { console.warn(`Webview "${name}" not ready`); return; }
  bhb.webview.send(wv.wcId, channel, data);
}

function loadAnimator(soul) {
  // Native animator — no webview, traits applied when chat tab opens
  if (soul?.animator?.traits && _animatorInited) {
    BHBAnimator.setTraits(soul.animator.traits, soul._female || false, soul.animator.mood_preset || 'happy');
  }
}

function pushTraitsToAnimator(soul) {
  if (!_animatorInited || !soul?.animator?.traits) return;
  BHBAnimator.setTraits(soul.animator.traits, soul._female || false, soul.animator.mood_preset || 'calm');
}

// ── TTS → Animator lip sync ────────────────────────────────────────────────

// ── Pop-out animator window ────────────────────────────────────────────────
let _popoutOpen = false;

async function togglePopout() {
  const btn  = document.getElementById('btn-popout-anim');
  const soul = APP.currentSoul;
  if (_popoutOpen) {
    await bhb.animatorPopout.close();
    _popoutOpen = false;
    if (btn) { btn.textContent = '⛶ Pop Out'; }
    return;
  }
  const result = await bhb.animatorPopout.open({
    traits: soul?.animator?.traits || {},
    female: soul?._female || false,
    mood:   soul?.animator?.mood_preset || 'happy',
    name:   soul?.name || '',
  });
  if (result.ok) {
    _popoutOpen = true;
    if (btn) { btn.textContent = '✕ Close Pop Out'; }
  }
}

async function speakResponse(text) {
  const soul = APP.currentSoul;
  if (!soul?.voice?.elevenlabs_voice_id || !APP.keys.elevenlabs) { setStatus('Ready'); return; }
  try {
    // Generate TTS → get local file path
    const filePath = await bhb.elevenlabs.tts({
      apiKey:  APP.keys.elevenlabs,
      voiceId: soul.voice.elevenlabs_voice_id,
      text,
      settings: {
        stability:        soul.voice.stability        ?? 0.45,
        similarity_boost: soul.voice.similarity_boost ?? 0.75,
        style:            soul.voice.style            ?? 0.30,
        speaker_boost:    soul.voice.speaker_boost    ?? true,
      }
    });

    setStatus('Loading audio...');
    const base64 = await bhb.file.readBase64(filePath);

    // Decode base64 → ArrayBuffer
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ab = bytes.buffer;

    // Make sure animator is ready
    initChatAnimator();

    // Load into BHBAnimator — decodes, generates auto-expressions, wires playback
    await BHBAnimator.loadAudioArrayBuffer(ab);

    // Show audio progress bar
    const bar = document.getElementById('chat-audio-bar');
    if (bar) bar.classList.remove('hidden');

    // Play in main window
    BHBAnimator.play();
    setStatus('Speaking...');

  } catch (e) {
    console.error('[App] speakResponse:', e);
    setStatus('Voice error');
  }
}

function base64ToBlob(b64, mimeType) {
  const binary = atob(b64); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}





function addMessage(role, content) {
  const msgs = document.getElementById('chat-messages');
  const welcome = msgs.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const el = document.createElement('div');
  el.className = `chat-msg chat-msg-${role}`;

  if (role === 'user') {
    el.innerHTML = `<div class="msg-bubble user-bubble">${escapeHtml(content)}</div>`;
  } else if (role === 'assistant') {
    const name = APP.currentSoul?.name || 'Agent';
    el.innerHTML = `
      <div class="msg-meta">${escapeHtml(name)}</div>
      <div class="msg-bubble agent-bubble">${escapeHtml(content)}</div>
    `;
  } else {
    el.innerHTML = `<div class="msg-error">${escapeHtml(content)}</div>`;
  }

  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function clearChat() {
  APP.chatHistory = [];
  const msgs = document.getElementById('chat-messages');
  msgs.innerHTML = `<div class="chat-welcome"><div class="chat-welcome-icon">◆</div><div>Chat cleared.</div></div>`;
}

function setStatus(text) {
  document.getElementById('chat-status').textContent = text;
}

// ── Settings Modal ─────────────────────────────────────────────────────────
function openSettings() {
  populateSettings();
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function populateSettings() {
  document.getElementById('settings-anthropic-key').value = APP.keys.anthropic || '';
  document.getElementById('settings-openai-key').value    = APP.keys.openai    || '';
  document.getElementById('settings-el-key').value        = APP.keys.elevenlabs || '';
  setSelect('settings-model', APP.settings.model || 'claude-opus-4-5');

  document.querySelectorAll('[data-settings-provider]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.settingsProvider === (APP.settings.provider || 'anthropic'));
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-settings-provider]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

async function saveSettings() {
  const prov = document.querySelector('[data-settings-provider].active')?.dataset.settingsProvider || 'anthropic';
  APP.keys = {
    anthropic:  document.getElementById('settings-anthropic-key').value.trim(),
    openai:     document.getElementById('settings-openai-key').value.trim(),
    elevenlabs: document.getElementById('settings-el-key').value.trim(),
  };
  APP.settings = {
    ...APP.settings,
    provider: prov,
    model:    document.getElementById('settings-model').value,
  };
  await bhb.keys.save(APP.keys);
  await bhb.settings.save(APP.settings);
  closeSettings();
  // Reload voices if key changed
  if (APP.keys.elevenlabs) loadVoices();
}

// ── Helpers ────────────────────────────────────────────────────────────────
const v    = id => document.getElementById(id)?.value?.trim() || '';
const set  = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
const csv  = id => v(id).split(',').map(s => s.trim()).filter(Boolean);
const setSelect = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
const sliderVal = id => parseFloat(document.getElementById(id)?.value || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const escapeHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');

function defaultExpressionMap() {
  return { happy:'Joy', neutral:'Stare', thinking:'Curious', angry:'Infuriated',
           sad:'Ouchy', surprised:'Surprised', serious:'Stern', idle:'Blink' };
}

function blankSoul(id) {
  return {
    schema_version: '1.0', character_id: id, name: 'New Character', tagline: '',
    personality: { archetype:'', traits:[], flaw:'', speaking_style:'', never_says:[], always_says:[], fears:[], desires:[] },
    backstory: { origin:'', occupation:'', history:'' },
    voice: { elevenlabs_voice_id: null, resolve_voice:{ descriptors:{}, fallback_voice_id:null },
             stability:0.45, similarity_boost:0.75, style:0.30, speaker_boost:true, notes:'' },
    animator: { traits:{}, mood_preset:'calm', expression_map: defaultExpressionMap() },
    agent_instructions: { agent_session_endpoint:'https://bigheadbillionaires.com/api/agent-session',
      prompt_prefix:'', content_boundaries:[], default_scene:'Graphite' },
    memory: { knows:[], relationships:[], notable_events:[] },
    _thumbnail: null,
  };
}

// ── Init ───────────────────────────────────────────────────────────────────
// ── Entry point ────────────────────────────────────────────────────────────
// Wait for DOM + preload bridge to be available before booting
window.addEventListener('DOMContentLoaded', () => {
  // Show a visible error if JS crashes so the window is never just black
  window.onerror = (msg, src, line, col, err) => {
    document.body.style.cssText = 'background:#0a0a0a;color:#fa5252;font-family:monospace;padding:40px;white-space:pre';
    document.body.textContent = 'Startup error:\n' + (err?.stack || msg);
  };

  // bhb bridge is injected by preload — poll briefly if not ready yet
  let attempts = 0;
  const tryBoot = () => {
    if (typeof bhb !== 'undefined' && bhb.keys) {
      boot().catch(err => {
        document.body.style.cssText = 'background:#0a0a0a;color:#fa5252;font-family:monospace;padding:40px;white-space:pre';
        document.body.textContent = 'Boot error:\n' + (err?.stack || err);
      });
    } else if (++attempts < 20) {
      setTimeout(tryBoot, 100);
    } else {
      document.body.style.cssText = 'background:#0a0a0a;color:#fa5252;font-family:monospace;padding:40px';
      document.body.textContent = 'Error: preload bridge (bhb) not available. Check preload.js is loading correctly.';
    }
  };
  tryBoot();
});

