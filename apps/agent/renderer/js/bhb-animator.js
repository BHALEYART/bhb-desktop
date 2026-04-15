/**
 * bhb-animator.js
 * Native reimplementation of the BHB Animator for use in the Chat tab.
 * No webview. No IPC. Runs entirely in the renderer process.
 *
 * Public API (all accessed via window.BHBAnimator):
 *   BHBAnimator.init(canvasEl)        — attach to a canvas element
 *   BHBAnimator.setTraits(traits, female, moodPreset) — load character
 *   BHBAnimator.loadAudioBlob(blob)   — decode audio + generate auto expressions
 *   BHBAnimator.loadAudioArrayBuffer(ab) — decode from ArrayBuffer (TTS pipeline)
 *   BHBAnimator.play()
 *   BHBAnimator.pause()
 *   BHBAnimator.reset()
 *   BHBAnimator.setMood(preset)       — 'mad'|'calm'|'happy'|'shocked'
 *   BHBAnimator.destroy()
 */

const BHBAnimator = (() => {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────
  const ASSET_BASE  = 'https://bhaleyart.github.io/BigHeadCharacterCooker';
  const LAYER_ORDER = ['BACKGROUNDS','BODY','TEXTURE','OUTFIT','BREASTS','HEAD','MOUTH','EYELASHES','EYES'];

  const TRAIT_FILES = {
    BODY:        ['Blank.png','Charcoal.png','High Voltage.png','Nebulous.png','Pinky.png','Shockwave.png','Tangerine.png','Turquoise.png','Woody.png','Frogger.png','Area 51.png','Dark Tone.png','Mid Tone.png','Light Tone.png','Jolly Roger.png','Cyber Punk.png','Talking Corpse.png','Day Tripper.png','Meat Lover.png','Golden God.png','Chrome Dome.png','Candy Gloss.png','Man On Fire.png','Water Boy.png','Icecream Man.png','Reptilian.png','Juiced Up.png','Toxic Waste.png','Love Potion.png','Pop Artist.png','Autopsy.png','Ghostly.png','Blue Screen.png','Networker.png','IceMan.png','TheLizard.png','Primal.png','PanduBeru.png'],
    BACKGROUNDS:  ['None.png','Natural.png','Mania.png','Regal.png','Lavish.png','Sunflower.png','Snowflake.png','Bleach.png','Vibes.png','Burst.png','Aquatic.png','Passionate.png','Envious.png','Enlightened.png','Haunted.png','Cursed.png','SolFlare.png','Tangerine.png','Navy.png','Crimson.png','Graphite.png','Eggshell.png','Slate.png','Kuwai.png','Velvet.png','Money.png','Sky.png'],
    EYES:        ['Curious.png','Alien.png','Annoyed.png','Demonic.png','Diamond.png','Dots.png','Grumpy.png','Hypnotized.png','Infuriated.png','Insect.png','Joy.png','Light Bright.png','Monocle.png','Ouchy.png','Paranoid.png','Possessed.png','Ruby Stare.png','Spider.png','Stare.png','Stoney Eyes.png','Sunglasses.png','Surprised.png','Tears.png','Deceased.png','Too Chill.png','VR Headset.png','3D Glasses.png','Blink.png','Stern.png','Tears.gif'],
    MOUTH:       ['Mmm.png','Simpleton.png','Stache.png','Creeper.png','Pierced.png','Fangs.png','Gold Teeth.png','Diamond Teeth.png','CandyGrill.png','Birdy.png','Panic.png','Sss.png','Ahh.png','Ehh.png','Uhh.png','LLL.png','Rrr.png','Fff.png','Ooo.png','Thh.png','Eee.png','Haha.png','Rofl.png','Bean Frown.png','Bean Smile.png','Smirk.png','Bored.png','Gas Mask.png','Scuba.png','Quacked.png'],
    HEAD:        ['None.png','Antenna.png','Bandana Bro.png','Beanie.png','Blonde Beanie.png','Blonde Bun.png','Blue Bedhead.png','Brain Squid.png','Bravo.png','Brunette Beanie.png','Brunette Ponytail.png','Burger Crown.png','Captain Hat.png','Mullet.png','Cat Hat.png','Chad Bandana.png','Cherry Sundae.png','Clown Wig.png','Fancy Hat.png','Fireman.png','Flame Princess.png','Fossilized.png','Gamer Girl.png','Ginger Ponytail.png','Kpop.png','Yagami.png','Raven.png','Heated.png','Inferno.png','Horny Horns.png','Hunted.png','Jester.png','Kingly.png','Mad Hatter.png','Masked Up.png','Mohawk Blue.png','Mohawk Green.png','Mohawk Red.png','Mortricia.png','Outlaw.png','Overload.png','Patrol Cap.png','Pharaoh Hat.png','Pink Pigtails.png','Powdered Wig.png','Press Pass.png','Propeller.png','Rainbow Babe.png','Recon Helmet.png','Robin Hood.png','Santa Hat.png','Sewer Slime.png','Snapback Blue.png','Snapback Hippy.png','Snapback Red.png','Snapback Yellow.png','Sombrero.png','Spiritual.png','Surgeon.png','UwU Kitty.png','Valhalla Cap.png','Way Dizzy.png','FoxFamous.png','Unplugged.png','Party-Animal.png'],
    OUTFIT:      ['None.png','Blue Tee.png','Blueberry Dye.png','Degen Green.png','Degen Purple.png','Earthy Dye.png','Hodl Black.png','Hodl White.png','Locked Up.png','Moto-X.png','Orange Zip.png','Passion Dye.png','Pink Zip.png','Raider Ref.png','Red Tee.png','Smally Bigs.png','Yellow Tee.png','Blue Zip.png','Red Zip.png','White Zip.png','Hornet Zip.png','Ghostly Zip.png','Gold Jacket.png','Tuxedo.png','Thrashed.png','The Fuzz.png','Pin Striped.png','Designer Zip.png','Luxury Zip.png','Explorer.png','Power Armor.png','Shinobi.png','Thrilled.png','Trenches.png','Ski Jacket.png','Sled Jacket.png','Commando.png','Space Cadet.png','Burgler.png','Commandant.png','Golden Knight.png','Honey Bee.png','Necromancer.png','Paladin.png','Refined Suit.png','Sexy Jacket.png','Stoner Hoodie.png','The Duke.png','Rave Hoodie.png','Scuba suit temp.png','Burger Suit.png','Scrubs.png','FlaredUp.png','Shiller.png','MetalFan.png','BH-Tshirt.png','Uni-Fyed.png','SuperFlare.png','BoigaRed.png'],
    TEXTURE:     ['None.png','Blood.png','Acid.png','Ink.png','Dart Frog Blue.png','Dart Frog Red.png','Dart Frog Yellow.png','Magical.png','Puzzled.png','Rug Life Ink.png','Pulverized.png','FlaredInk.png'],
    EYELASHES:   ['Eyelashes.png'],   // GIRL folder
    BREASTS:     ['Breasts.png'],     // GIRL folder
  };

  const FEMALE_CATS = { EYELASHES: 'GIRL', BREASTS: 'GIRL' };
  const FOLDER_MAP  = { EYELASHES: 'GIRL', BREASTS: 'GIRL' }; // others use cat name

  const SUBSET_EYES = {
    'Alien.png':       {'Stare.png':'EYES/SUBSET/alien.png','Blink.png':'EYES/SUBSET/alien-blink.png','Ouchy.png':'EYES/SUBSET/alien-ouchy.png','Infuriated.png':'EYES/SUBSET/alien-infuriated.png','Surprised.png':'EYES/SUBSET/alien-surprised.png','Stern.png':'EYES/SUBSET/alien-stern.png','Joy.png':'EYES/SUBSET/alien-joy.png','Curious.png':'EYES/SUBSET/alien-curious.png'},
    'Sunglasses.png':  {'Stare.png':'EYES/SUBSET/sunglasses.png','Blink.png':'EYES/SUBSET/sunglasses-blink.png','Ouchy.png':'EYES/SUBSET/sunglasses-ouchy.png','Infuriated.png':'EYES/SUBSET/sunglasses-infuriated.png','Surprised.png':'EYES/SUBSET/sunglasses-surprised.png','Stern.png':'EYES/SUBSET/sunglasses-stern.png','Joy.png':'EYES/SUBSET/sunglasses-joy.png','Curious.png':'EYES/SUBSET/sunglasses-curious.png'},
    '3D Glasses.png':  {'Stare.png':'EYES/SUBSET/3dglasses.png','Blink.png':'EYES/SUBSET/3dglasses-blink.png','Ouchy.png':'EYES/SUBSET/3dglasses-ouchy.png','Infuriated.png':'EYES/SUBSET/3dglasses-infuriated.png','Surprised.png':'EYES/SUBSET/3dglasses-surprised.png','Stern.png':'EYES/SUBSET/3dglasses-stern.png','Joy.png':'EYES/SUBSET/3dglasses-joy.png','Curious.png':'EYES/SUBSET/3dglasses-curious.png'},
    'Spider.png':      {'Stare.png':'EYES/SUBSET/spider.png','Blink.png':'EYES/SUBSET/spider-blink.png','Ouchy.png':'EYES/SUBSET/spider-ouchy.png','Infuriated.png':'EYES/SUBSET/spider-infuriated.png','Surprised.png':'EYES/SUBSET/spider-surprised.png','Stern.png':'EYES/SUBSET/spider-stern.png','Joy.png':'EYES/SUBSET/spider-joy.png','Curious.png':'EYES/SUBSET/spider-curious.png'},
    'Diamond.png':     {'Stare.png':'EYES/SUBSET/diamond.png','Blink.png':'EYES/SUBSET/diamond-blink.png','Ouchy.png':'EYES/SUBSET/diamond-ouchy.png','Infuriated.png':'EYES/SUBSET/diamond-infuriated.png','Surprised.png':'EYES/SUBSET/diamond-surprised.png','Stern.png':'EYES/SUBSET/diamond-stern.png','Joy.png':'EYES/SUBSET/diamond-joy.png','Curious.png':'EYES/SUBSET/diamond-curious.png'},
    'Ruby Stare.png':  {'Stare.png':'EYES/SUBSET/ruby.png','Blink.png':'EYES/SUBSET/ruby-blink.png','Ouchy.png':'EYES/SUBSET/ruby-ouchy.png','Infuriated.png':'EYES/SUBSET/ruby-infuriated.png','Surprised.png':'EYES/SUBSET/ruby-surprised.png','Stern.png':'EYES/SUBSET/ruby-stern.png','Joy.png':'EYES/SUBSET/ruby-joy.png','Curious.png':'EYES/SUBSET/ruby-curious.png'},
    'Hypnotized.png':  {'Stare.png':'EYES/SUBSET/hypnotized.png','Blink.png':'EYES/SUBSET/hypnotized-blink.png','Ouchy.png':'EYES/SUBSET/hypnotized-ouchy.png','Infuriated.png':'EYES/SUBSET/hypnotized-infuriated.png','Surprised.png':'EYES/SUBSET/hypnotized-surprised.png','Stern.png':'EYES/SUBSET/hypnotized-stern.png','Joy.png':'EYES/SUBSET/hypnotized-joy.png','Curious.png':'EYES/SUBSET/hypnotized-curious.png'},
    'Monocle.png':     {'Stare.png':'EYES/SUBSET/monocle.png','Blink.png':'EYES/SUBSET/monocle-blink.png','Ouchy.png':'EYES/SUBSET/monocle-ouchy.png','Infuriated.png':'EYES/SUBSET/monocle-infuriated.png','Surprised.png':'EYES/SUBSET/monocle-surprised.png','Stern.png':'EYES/SUBSET/monocle-stern.png','Joy.png':'EYES/SUBSET/monocle-joy.png','Curious.png':'EYES/SUBSET/monocle-curious.png'},
    'Demonic.png':     {'Stare.png':'EYES/SUBSET/demonic.png','Blink.png':'EYES/SUBSET/demonic-blink.png','Ouchy.png':'EYES/SUBSET/demonic-ouchy.png','Infuriated.png':'EYES/SUBSET/demonic-infuriated.png','Surprised.png':'EYES/SUBSET/demonic-surprised.png','Stern.png':'EYES/SUBSET/demonic-stern.png','Joy.png':'EYES/SUBSET/demonic-joy.png','Curious.png':'EYES/SUBSET/demonic-curious.png'},
    'Light Bright.png':{'Stare.png':'EYES/SUBSET/lightbright.png','Blink.png':'EYES/SUBSET/lightbright-blink.png','Ouchy.png':'EYES/SUBSET/lightbright-ouchy.png','Infuriated.png':'EYES/SUBSET/lightbright-infuriated.png','Surprised.png':'EYES/SUBSET/lightbright-surprised.png','Stern.png':'EYES/SUBSET/lightbright-stern.png','Joy.png':'EYES/SUBSET/lightbright-joy.png','Curious.png':'EYES/SUBSET/lightbright-curious.png'},
    'Possessed.png':   {'Stare.png':'EYES/SUBSET/possesed.png','Blink.png':'EYES/SUBSET/possesed-blink.png','Ouchy.png':'EYES/SUBSET/possesed-ouchy.png','Infuriated.png':'EYES/SUBSET/possesed-infuriated.png','Surprised.png':'EYES/SUBSET/possesed-surprised.png','Stern.png':'EYES/SUBSET/possesed-stern.png','Joy.png':'EYES/SUBSET/possesed-joy.png','Curious.png':'EYES/SUBSET/possesed-curious.png'},
    'Dots.png':        {'Stare.png':'EYES/SUBSET/dots.png','Blink.png':'EYES/SUBSET/dots-blink.png','Ouchy.png':'EYES/SUBSET/dots-ouchy.png','Infuriated.png':'EYES/SUBSET/dots-infuriated.png','Surprised.png':'EYES/SUBSET/dots-surprised.png','Stern.png':'EYES/SUBSET/dots-stern.png','Joy.png':'EYES/SUBSET/dots-joy.png','Curious.png':'EYES/SUBSET/dots-curious.png'},
    'Stoney Eyes.png': {'Stare.png':'EYES/SUBSET/stoneyeyes.png','Blink.png':'EYES/SUBSET/stoneyeyes-blink.png','Ouchy.png':'EYES/SUBSET/stoneyeyes-ouchy.png','Infuriated.png':'EYES/SUBSET/stoneyeyes-infuriated.png','Surprised.png':'EYES/SUBSET/stoneyeyes-surprised.png','Stern.png':'EYES/SUBSET/stoneyeyes-stern.png','Joy.png':'EYES/SUBSET/stoneyeyes-joy.png','Curious.png':'EYES/SUBSET/stoneyeyes-curious.png'},
    'VR Headset.png':  {'Stare.png':'EYES/SUBSET/vrheadset.png','Blink.png':'EYES/SUBSET/vrheadset.png','Ouchy.png':'EYES/SUBSET/vrheadset.png','Infuriated.png':'EYES/SUBSET/vrheadset.png','Surprised.png':'EYES/SUBSET/vrheadset.png','Stern.png':'EYES/SUBSET/vrheadset.png','Joy.png':'EYES/SUBSET/vrheadset.png','Curious.png':'EYES/SUBSET/vrheadset.png'},
    'Too Chill.png':   {'Stare.png':'EYES/SUBSET/toochill.png','Blink.png':'EYES/SUBSET/toochill-blink.png','Ouchy.png':'EYES/SUBSET/toochill-blink.png','Infuriated.png':'EYES/SUBSET/toochill.png','Surprised.png':'EYES/SUBSET/toochill.png','Stern.png':'EYES/SUBSET/toochill.png','Joy.png':'EYES/SUBSET/toochill.png','Curious.png':'EYES/SUBSET/toochill.png'},
    'Deceased.png':    {'Stare.png':'EYES/SUBSET/deceased.png','Blink.png':'EYES/SUBSET/deceased-blink.png','Ouchy.png':'EYES/SUBSET/deceased-ouchy.png','Infuriated.png':'EYES/SUBSET/deceased.png','Surprised.png':'EYES/SUBSET/deceased.png','Stern.png':'EYES/SUBSET/deceased.png','Joy.png':'EYES/SUBSET/deceased.png','Curious.png':'EYES/SUBSET/deceased.png'},
    'Grumpy.png':      {'Stare.png':'EYES/SUBSET/grumpy.png','Blink.png':'EYES/SUBSET/grumpy-ouchy.png','Ouchy.png':'EYES/SUBSET/grumpy-ouchy.png','Infuriated.png':'EYES/SUBSET/grumpy.png','Surprised.png':'EYES/SUBSET/grumpy.png','Stern.png':'EYES/SUBSET/grumpy.png','Joy.png':'EYES/SUBSET/grumpy.png','Curious.png':'EYES/SUBSET/grumpy.png'},
    'Paranoid.png':    {'Stare.png':'EYES/SUBSET/paranoid.png','Blink.png':'EYES/SUBSET/paranoid-ouchy.png','Ouchy.png':'EYES/SUBSET/paranoid-ouchy.png','Infuriated.png':'EYES/SUBSET/paranoid.png','Surprised.png':'EYES/SUBSET/paranoid.png','Stern.png':'EYES/SUBSET/paranoid.png','Joy.png':'EYES/SUBSET/paranoid.png','Curious.png':'EYES/SUBSET/paranoid.png'},
    'Insect.png':      {'Stare.png':'EYES/SUBSET/insect.png','Blink.png':'EYES/SUBSET/insect-ouchy.png','Ouchy.png':'EYES/SUBSET/insect-ouchy.png','Infuriated.png':'EYES/SUBSET/insect.png','Surprised.png':'EYES/SUBSET/insect.png','Stern.png':'EYES/SUBSET/insect.png','Joy.png':'EYES/SUBSET/insect.png','Curious.png':'EYES/SUBSET/insect.png'},
    'Annoyed.png':     {'Stare.png':'EYES/SUBSET/annoyed.png','Blink.png':'EYES/SUBSET/annoyed-blink.png','Ouchy.png':'EYES/SUBSET/annoyed-blink.png','Infuriated.png':'EYES/SUBSET/annoyed.png','Surprised.png':'EYES/SUBSET/annoyed.png','Stern.png':'EYES/SUBSET/annoyed.png','Joy.png':'EYES/SUBSET/annoyed.png','Curious.png':'EYES/SUBSET/annoyed.png'},
  };

  const MOODS = {
    mad:     { high:[['Infuriated.png',0.55],['Ouchy.png',0.30],['Stern.png',0.15]],     mid:[['Stern.png',0.45],['Ouchy.png',0.35],['Infuriated.png',0.20]], low:[['Stern.png',0.60],['Ouchy.png',0.25],['Infuriated.png',0.15]] },
    calm:    { high:[['Stern.png',0.50],['Curious.png',0.35],['Stare.png',0.15]],         mid:[['Curious.png',0.45],['Stern.png',0.35],['Stare.png',0.20]],     low:[['Stare.png',0.50],['Curious.png',0.30],['Stern.png',0.20]] },
    happy:   { high:[['Surprised.png',0.50],['Joy.png',0.35],['Curious.png',0.15]],       mid:[['Joy.png',0.45],['Curious.png',0.35],['Surprised.png',0.20]],   low:[['Curious.png',0.55],['Joy.png',0.30],['Surprised.png',0.15]] },
    shocked: { high:[['Surprised.png',0.55],['Ouchy.png',0.30],['Curious.png',0.15]],     mid:[['Ouchy.png',0.40],['Surprised.png',0.35],['Curious.png',0.25]], low:[['Curious.png',0.55],['Ouchy.png',0.25],['Surprised.png',0.20]] },
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let _canvas   = null;
  let _ctx      = null;
  let _rafId    = null;
  let _mood     = 'happy';
  let _onEnded  = null; // external callback

  // Image caches
  const _imgCache    = {};  // layerKey → Image[]  (indexed by file index)
  const _subsetCache = {};  // path → Image

  // Character state
  let _char = {
    indices:      {},
    female:       false,
    audioBuffer:  null,
    audioDuration: 0,
    audioEl:      null,
    audioCtx:     null,
    gainNode:     null,
    mediaElSrc:   null,
    currentTime:  0,
    playing:      false,
    keyframes:    [],
    autoLipSync:  true,
    syncStyle:    'ehh',
  };

  // ── Image helpers ─────────────────────────────────────────────────────────
  function _imgUrl(cat, file) {
    const folder = FOLDER_MAP[cat] || cat;
    return `${ASSET_BASE}/${folder}/${encodeURIComponent(file)}`;
  }

  function _loadImg(url) {
    if (_imgCache[url]) return _imgCache[url];
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    _imgCache[url] = img;
    return img;
  }

  function _getSubsetImg(path) {
    if (_subsetCache[path]) return _subsetCache[path];
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `${ASSET_BASE}/${path}`;
    _subsetCache[path] = img;
    return img;
  }

  function _preloadSubsets() {
    Object.values(SUBSET_EYES).forEach(map => Object.values(map).forEach(_getSubsetImg));
  }

  // Preload all images for current trait indices
  function _preloadTraitImages() {
    for (const cat of LAYER_ORDER) {
      const files = TRAIT_FILES[cat];
      if (!files) continue;
      const idx = _char.indices[cat] ?? 0;
      // Preload the current index and neighbors
      [-1, 0, 1].forEach(d => {
        const i = idx + d;
        if (i >= 0 && i < files.length) {
          _loadImg(_imgUrl(cat, files[i]));
        }
      });
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function _getImg(cat, idx) {
    const files = TRAIT_FILES[cat];
    if (!files || idx < 0 || idx >= files.length) return null;
    return _loadImg(_imgUrl(cat, files[idx]));
  }

  function _mouthFor(time) {
    // Manual keyframe wins
    for (let i = _char.keyframes.length - 1; i >= 0; i--) {
      const kf = _char.keyframes[i];
      if (kf.type === 'mouth' && kf.time <= time) return kf.value;
    }
    // Auto lip sync
    if (_char.autoLipSync && _char.audioBuffer) {
      const vol = _volumeAt(time);
      if (vol > 0.12) return 'Ahh.png';
      if (vol > 0.05) return _char.syncStyle === 'ooo' ? 'Ooo.png' : 'Ehh.png';
      if (vol > 0.02) return 'Eee.png';
      return 'Mmm.png';
    }
    return null;
  }

  function _eyesFor(time) {
    let active = null;
    for (const kf of _char.keyframes) {
      if (kf.type === 'blink') {
        if (time >= kf.time && time < kf.time + (kf.duration ?? 0.12)) return 'Blink.png';
      }
      if ((kf.type === 'eyes' || kf.type === 'ouchy') && kf.time <= time) active = kf.value;
    }
    return active;
  }

  function _volumeAt(time) {
    if (!_char.audioBuffer) return 0;
    const sr  = _char.audioBuffer.sampleRate;
    const pos = Math.floor(time * sr);
    const win = Math.floor(sr * 0.02);
    const data = _char.audioBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < win && pos + i < data.length; i++) sum += Math.abs(data[pos + i]);
    return sum / win;
  }

  function _drawFrame() {
    if (!_canvas || !_ctx) return;
    const W = _canvas.width, H = _canvas.height;
    _ctx.clearRect(0, 0, W, H);

    const time = _char.currentTime;

    for (const cat of LAYER_ORDER) {
      // Female-only layers
      if (FEMALE_CATS[cat] && !_char.female) continue;

      let idx = _char.indices[cat] ?? 0;

      if (cat === 'MOUTH') {
        const m = _mouthFor(time);
        if (m) {
          const mi = TRAIT_FILES.MOUTH.indexOf(m);
          if (mi >= 0) idx = mi;
        }
      }

      if (cat === 'EYES') {
        const expr = _eyesFor(time);
        if (expr) {
          const baseTrait = TRAIT_FILES.EYES[_char.indices.EYES ?? 0];
          const subsetMap = SUBSET_EYES[baseTrait];
          if (subsetMap?.[expr]) {
            const sub = _getSubsetImg(subsetMap[expr]);
            if (sub.complete && sub.naturalWidth) _ctx.drawImage(sub, 0, 0, W, H);
            continue;
          }
          const ei = TRAIT_FILES.EYES.indexOf(expr);
          if (ei >= 0) idx = ei;
        }
      }

      const img = _getImg(cat, idx);
      if (img && img.complete && img.naturalWidth) _ctx.drawImage(img, 0, 0, W, H);
    }
  }

  function _startRaf() {
    if (_rafId) return;
    const tick = () => {
      if (_char.playing) _char.currentTime = _char.audioEl?.currentTime ?? _char.currentTime;
      _drawFrame();
      _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
  }

  function _stopRaf() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  // ── Auto Expressions ───────────────────────────────────────────────────────
  function _generateAutoExpressions() {
    if (!_char.audioBuffer) return;
    // Remove previous auto-generated keyframes
    _char.keyframes = _char.keyframes.filter(k => !k._auto);

    const buf  = _char.audioBuffer;
    const sr   = buf.sampleRate;
    const data = buf.getChannelData(0);
    const mood = MOODS[_mood] || MOODS.happy;

    const FRAME_MS = 30, HOP_MS = 15;
    const frameSz  = Math.round(sr * FRAME_MS / 1000);
    const hopSz    = Math.round(sr * HOP_MS  / 1000);

    const SILENCE_THRESH = 0.020, HIGH_THRESH = 0.11, MID_THRESH = 0.040;
    const MIN_ONSET_GAP  = 1.2, LOOK_AHEAD_MS = 350;
    const lookFrames     = Math.round(LOOK_AHEAD_MS / HOP_MS);
    const MIN_SILENCE_FOR_BLINK = 0.8, MIN_BLINK_INTERVAL = 1.8;

    // Build RMS frames
    const frames = [];
    for (let s = 0; s + frameSz <= data.length; s += hopSz) {
      let sq = 0;
      for (let i = 0; i < frameSz; i++) sq += data[s + i] * data[s + i];
      frames.push({ t: s / sr, rms: Math.sqrt(sq / frameSz) });
    }
    // Smooth
    for (let i = 1; i < frames.length - 1; i++) {
      frames[i].rms = (frames[i-1].rms + frames[i].rms + frames[i+1].rms) / 3;
    }

    const isSpeech = frames.map((f, i) => {
      const prev = frames[i-1]?.rms ?? 0, next = frames[i+1]?.rms ?? 0;
      return Math.max(f.rms, prev, next) > SILENCE_THRESH;
    });

    // Detect onsets
    const onsets = [];
    let lastOnsetTime = -MIN_ONSET_GAP;
    for (let i = 1; i < frames.length; i++) {
      if (!isSpeech[i-1] && isSpeech[i]) {
        const t = frames[i].t;
        if (t - lastOnsetTime < MIN_ONSET_GAP) continue;
        let sum = 0, cnt = 0;
        for (let j = i; j < Math.min(i + lookFrames, frames.length); j++) { sum += frames[j].rms; cnt++; }
        onsets.push({ time: t, rms: cnt ? sum / cnt : frames[i].rms });
        lastOnsetTime = t;
      }
    }

    // Seeded RNG for repeatability
    let seed = Math.floor(buf.duration * 1000) & 0xFFFF;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF; return (seed >>> 0) / 0xFFFFFFFF; };
    const pick = (pool, avoid) => {
      const src = pool.filter(([e]) => e !== avoid);
      const use = src.length > 0 ? src : pool;
      const tot = use.reduce((s, [,w]) => s + w, 0);
      let r = rng() * tot;
      for (const [expr, w] of use) { r -= w; if (r <= 0) return expr; }
      return use[0][0];
    };

    const kfs = [];
    let lastExpr = null, lastBlinkTime = -MIN_BLINK_INTERVAL;

    for (const onset of onsets) {
      const tier = onset.rms > HIGH_THRESH ? 'high' : onset.rms > MID_THRESH ? 'mid' : 'low';
      const expr = pick(mood[tier], lastExpr);
      const isOuchy = expr === 'Ouchy.png';
      const needsBlink = !isOuchy && lastExpr !== null && lastExpr !== 'Ouchy.png' && onset.time > 0.15;
      if (needsBlink) {
        const bt = Math.max(0, onset.time - 0.12);
        kfs.push({ time: bt, type: 'blink', value: 'Blink.png', duration: 0.12, _auto: true });
        lastBlinkTime = bt;
      }
      kfs.push({ time: onset.time, type: isOuchy ? 'ouchy' : 'eyes', value: expr, _auto: true });
      lastExpr = expr;
    }

    // Silence blinks
    let silenceStart = null;
    for (let i = 0; i < frames.length; i++) {
      if (!isSpeech[i]) {
        if (silenceStart === null) silenceStart = frames[i].t;
        const silenceDur = frames[i].t - silenceStart;
        const timeSince  = frames[i].t - lastBlinkTime;
        if (silenceDur >= MIN_SILENCE_FOR_BLINK && timeSince >= MIN_BLINK_INTERVAL) {
          kfs.push({ time: silenceStart + silenceDur * 0.5, type: 'blink', value: 'Blink.png', duration: 0.12, _auto: true });
          lastBlinkTime = silenceStart + silenceDur * 0.5;
          silenceStart  = frames[i].t;
        }
      } else {
        silenceStart = null;
      }
    }

    _char.keyframes.push(...kfs);
    _char.keyframes.sort((a, b) => a.time - b.time);
    console.log(`[BHBAnimator] Auto expressions (${_mood}): ${kfs.filter(k => k.type !== 'blink').length} expr, ${kfs.filter(k => k.type === 'blink').length} blinks`);
  }

  // ── Audio setup ────────────────────────────────────────────────────────────
  function _ensureAudioEl() {
    if (!_char.audioEl) {
      _char.audioEl = document.createElement('audio');
      _char.audioEl.style.display = 'none';
      document.body.appendChild(_char.audioEl);
    }
    return _char.audioEl;
  }

  function _ensureAudioCtx() {
    if (!_char.audioCtx) {
      _char.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _char.audioCtx;
  }

  function _wireGain() {
    const c = _char;
    if (c.audioCtx && !c.mediaElSrc) {
      try {
        c.mediaElSrc = c.audioCtx.createMediaElementSource(c.audioEl);
        c.gainNode   = c.audioCtx.createGain();
        c.gainNode.gain.value = 1.0;
        c.mediaElSrc.connect(c.gainNode);
        c.gainNode.connect(c.audioCtx.destination);
      } catch(e) { console.warn('[BHBAnimator] GainNode wiring failed:', e); }
    }
  }

  function _onAudioReady(audioBuffer) {
    _char.audioBuffer   = audioBuffer;
    _char.audioDuration = audioBuffer.duration;
    _char.currentTime   = 0;
    _char.keyframes     = [];

    _wireGain();

    _char.audioEl.removeEventListener('timeupdate', _char._onTimeUpdate || null);
    _char.audioEl.removeEventListener('ended',      _char._onEnded     || null);

    _char._onTimeUpdate = () => {
      _char.currentTime = _char.audioEl.currentTime;
      _drawFrame();
    };
    _char._onEnded = () => {
      _char.playing = false;
      _char.currentTime = 0;
      _drawFrame();
      if (typeof _onEnded === 'function') _onEnded();
    };
    _char.audioEl.addEventListener('timeupdate', _char._onTimeUpdate);
    _char.audioEl.addEventListener('ended',      _char._onEnded);

    _generateAutoExpressions();
    _startRaf();
    console.log('[BHBAnimator] Audio ready, duration:', audioBuffer.duration.toFixed(2) + 's');
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function init(canvasEl) {
    _canvas = canvasEl;
    _ctx    = canvasEl.getContext('2d');
    _preloadSubsets();
    _drawFrame();
    console.log('[BHBAnimator] Initialized on canvas', canvasEl.id || canvasEl);
  }

  function setTraits(traitsObj, female = false, moodPreset = 'happy') {
    _mood         = moodPreset;
    _char.female  = female;

    // Map trait name strings (without extension) to file indices
    const nameToIdx = (cat, name) => {
      const files = TRAIT_FILES[cat] || [];
      // Try exact match first (with extension), then name match
      let idx = files.findIndex(f => f === name);
      if (idx < 0) idx = files.findIndex(f => f.replace(/\.(png|gif)$/i, '') === name);
      return idx >= 0 ? idx : 0;
    };

    const keyMap = { BACKGROUND: 'BACKGROUNDS' }; // soul file uses BACKGROUND
    for (const [key, val] of Object.entries(traitsObj)) {
      const cat = keyMap[key] || key;
      if (TRAIT_FILES[cat]) {
        _char.indices[cat] = nameToIdx(cat, val);
      }
    }

    _preloadTraitImages();

    // Re-generate expressions if audio already loaded
    if (_char.audioBuffer) _generateAutoExpressions();
    _drawFrame();
  }

  async function loadAudioArrayBuffer(arrayBuffer) {
    _ensureAudioEl();
    const ctx = _ensureAudioCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch(_) {}
    }

    // Set blob URL for playback
    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    if (_char.audioUrl) URL.revokeObjectURL(_char.audioUrl);
    _char.audioUrl = URL.createObjectURL(blob);
    _char.audioEl.src = _char.audioUrl;
    _char.audioEl.load();

    // Decode for analysis
    return new Promise((resolve, reject) => {
      ctx.decodeAudioData(
        arrayBuffer.slice(0), // clone so source isn't neutered
        (buffer) => { _onAudioReady(buffer); resolve(buffer); },
        (err)    => { console.error('[BHBAnimator] decodeAudioData failed:', err); reject(err); }
      );
    });
  }

  async function loadAudioBlob(blob) {
    const ab = await blob.arrayBuffer();
    return loadAudioArrayBuffer(ab);
  }

  function play() {
    if (!_char.audioDuration || _char.playing) return;
    if (_char.audioCtx?.state === 'suspended') _char.audioCtx.resume().catch(() => {});
    _char.audioEl.play().catch(e => console.error('[BHBAnimator] play() failed:', e));
    _char.playing = true;
    _startRaf();
  }

  function pause() {
    _char.audioEl?.pause();
    _char.playing = false;
  }

  function reset() {
    pause();
    if (_char.audioEl) { _char.audioEl.currentTime = 0; }
    _char.currentTime = 0;
    _drawFrame();
  }

  function setMood(preset) {
    if (MOODS[preset]) {
      _mood = preset;
      if (_char.audioBuffer) _generateAutoExpressions();
    }
  }

  function setOnEnded(cb) { _onEnded = cb; }

  function isPlaying() { return _char.playing; }

  function destroy() {
    _stopRaf();
    pause();
    if (_char.audioEl) { document.body.removeChild(_char.audioEl); _char.audioEl = null; }
    if (_char.audioCtx) { _char.audioCtx.close().catch(() => {}); _char.audioCtx = null; }
    _canvas = null; _ctx = null;
  }

  return { init, setTraits, loadAudioArrayBuffer, loadAudioBlob, play, pause, reset, setMood, setOnEnded, isPlaying, destroy };
})();

window.BHBAnimator = BHBAnimator;
